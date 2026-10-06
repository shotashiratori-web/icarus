import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import type { FieldLogEntry } from '../types/zukan';
import type { Screen } from '../App';
import type {
  FieldEditOption,
  FieldEditValues,
  FieldEditableField,
  FieldEntryDetail,
  FieldEntryHistoryItem,
} from '../types/fieldEntryEdit';
import { useAuth } from '../context/AuthContext';
import { useZukanFieldStore } from '../store/zukanFieldStore';
import {
  fetchFieldEditOptions,
  fetchFieldEntryDetail,
  fetchFieldEntryHistory,
  patchFieldEntry,
  voidFieldEntry,
  FieldEditConflictError,
} from '../api/fieldEntryEditApi';
import { TokenExpiredError } from '../api/icarusApi';
import {
  loadFieldLogDraft,
  saveFieldLogDraft,
  clearFieldLogDraft,
  isOldDraft,
  formatDraftSavedAt,
  type FieldLogDraft,
  type FieldLogDraftChanges,
} from '../utils/fieldLogDraft';
import {
  FIELD_LABELS,
  adjustForLargeCategory,
  choicesFor,
  diffValues,
  formatHistoryTime,
  formatHistoryValue,
  historyForDisplay,
  historySourceLabel,
  rebaseAfterConflict,
  toggleObservedPart,
  validateEditValues,
  valuesFromDetail,
} from '../utils/fieldEntryEdit';
import HomeButton from '../components/HomeButton';
import styles from './ZukanFieldDetailScreen.module.css';

// Leafletをこの画面の主バンドルへ含めないよう遅延読み込みする（ZukanFieldMapScreenと同じ方針）
const FieldGpsMiniMap = lazy(() => import('../components/FieldGpsMiniMap'));

function buildDirectionsUrl(lat: number, lng: number): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
}

type Props = { go: (s: Screen) => void; entry: FieldLogEntry; from: Screen };

const DRAFT_SAVE_DEBOUNCE_MS = 800;

// 詳細画面の「分類・状態」に並べる項目（食材名・場所・日付・メモは画面上部に別に出す）
const CLASSIFICATION_FIELDS: FieldEditableField[] = [
  'subject_type', 'large_category', 'sub_category', 'phase', 'observed_parts', 'identification_status', 'harvested',
];
const SELECT_FIELDS: Exclude<FieldEditableField, 'observed_parts'>[] = [
  'subject_type', 'large_category', 'sub_category', 'phase', 'identification_status', 'harvested',
];

function fieldsText(fields: FieldEditableField[]): string {
  return fields.map((f) => FIELD_LABELS[f] ?? f).join('・');
}

// Editing & Classification（icarus_editing_classification_final_design.md）:
// active staff以上が全記録を編集できる。保存はWorkerの編集API（D1が正本）で、
// 変えた項目だけをexpectedUpdatedAt付きで送る。他の人が先に保存していたら409 → 最新を読み込み直す。
export default function ZukanFieldDetailScreen({ go, entry, from }: Props) {
  const { idToken, staffMe, handleTokenExpired } = useAuth();
  const canEditBase = staffMe?.staffStatus === 'active' && !!entry.eventId;
  // 無効化（削除の代わり）は管理者だけ。設計: icarus_field_log_void_design.md
  const isAdmin = canEditBase && staffMe?.role === 'admin';

  const [detail, setDetail] = useState<FieldEntryDetail | null>(null);
  const [detailError, setDetailError] = useState('');
  const [options, setOptions] = useState<FieldEditOption[] | null>(null);

  // base = 編集を始めた時点（または競合後に読み込み直した時点）の値。差分はbaseとの比較で作る
  const [base, setBase] = useState<FieldEditValues | null>(null);
  const [form, setForm] = useState<FieldEditValues | null>(null);

  const [isEditing, setIsEditing] = useState(false);
  const [isPreparing, setIsPreparing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [saveNotice, setSaveNotice] = useState('');
  const [conflict, setConflict] = useState<{ mine: FieldEditableField[]; overlap: FieldEditableField[] } | null>(null);
  const [showUnsavedConfirm, setShowUnsavedConfirm] = useState(false);
  const [draftPrompt, setDraftPrompt] = useState<FieldLogDraft | null>(null);
  const [draftSaveFailedNotice, setDraftSaveFailedNotice] = useState(false);

  const [voidOpen, setVoidOpen] = useState(false);
  const [voidReason, setVoidReason] = useState('');
  const [isVoiding, setIsVoiding] = useState(false);
  const [voidError, setVoidError] = useState('');
  const voidRequestRef = useRef<string | null>(null);

  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyItems, setHistoryItems] = useState<FieldEntryHistoryItem[] | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState('');

  const foodNameInputRef = useRef<HTMLInputElement>(null);
  const noticeTimerRef = useRef<number | null>(null);
  const draftSaveTimerRef = useRef<number | null>(null);
  const draftSaveFailedShownRef = useRef(false);
  // 通信断の後に同じ内容で保存し直す時は同じrequestIdを使う（Workerが二重に書かない）
  const pendingRequestRef = useRef<{ key: string; requestId: string } | null>(null);

  const isVoided = detail?.status === 'voided';
  // 無効化された記録は編集しない（戻すのは管理者の restore。通常の画面には置かない）
  const canEdit = canEditBase && !isVoided;

  const hasGps = Number.isFinite(entry.lat) && Number.isFinite(entry.lng) && !(entry.lat === 0 && entry.lng === 0);

  // 表示用の値。D1の現在値を読めたらそちらを使い、読めるまでは地図データ（entry）を出す
  const shown = {
    food: detail?.food ?? entry.foodName,
    place: detail?.place ?? entry.place,
    date: detail?.date ?? entry.date,
    memo: detail?.memo ?? entry.memo,
    kigo: detail?.kigo ?? entry.kigo,
  };

  const errors = isEditing && form ? validateEditValues(form) : {};
  const hasErrors = Object.keys(errors).length > 0;
  const patch = base && form ? diffValues(base, form) : {};
  const hasDiff = Object.keys(patch).length > 0;

  const handleError = (e: unknown, fallback: string): string => {
    if (e instanceof TokenExpiredError) handleTokenExpired();
    return e instanceof Error ? e.message : fallback;
  };

  // 分類・状態は地図データに含まれないため、詳細を開いた時にD1の現在値を読む
  useEffect(() => {
    if (!entry.eventId || !idToken) return;
    let cancelled = false;
    fetchFieldEntryDetail(entry.eventId, idToken)
      .then((d) => { if (!cancelled) setDetail(d); })
      .catch((e) => { if (!cancelled) setDetailError(handleError(e, '記録の詳細を読み込めませんでした')); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entry.eventId, idToken]);

  // 画面表示時、同じentryIdの下書きが残っていないか確認する（自動上書きはしない）
  useEffect(() => {
    if (!entry.eventId) return;
    const draft = loadFieldLogDraft(entry.eventId);
    if (!draft) return;
    const c = draft.changes;
    const differs =
      (typeof c.foodName === 'string' && c.foodName !== entry.foodName) ||
      (typeof c.location === 'string' && c.location !== entry.place) ||
      (typeof c.memo === 'string' && c.memo !== entry.memo);
    if (differs) setDraftPrompt(draft);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entry.eventId]);

  // 編集開始時のフォーカス：食材名が未入力（「無題」表示）なら食材名を選ぶ
  useEffect(() => {
    if (!isEditing || !base) return;
    if (!base.food && foodNameInputRef.current) foodNameInputRef.current.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isEditing]);

  // 入力後debounceして、文字入力の項目（食材名・場所・メモ）の下書きを端末に保存する
  useEffect(() => {
    if (!isEditing || !entry.eventId || !base || !form) return;
    if (draftSaveTimerRef.current) window.clearTimeout(draftSaveTimerRef.current);
    draftSaveTimerRef.current = window.setTimeout(() => {
      const changes: FieldLogDraftChanges = {};
      if (form.food !== base.food) changes.foodName = form.food;
      if (form.place !== base.place) changes.location = form.place;
      if (form.memo !== base.memo) changes.memo = form.memo;
      if (Object.keys(changes).length === 0) {
        clearFieldLogDraft(entry.eventId);
        return;
      }
      const ok = saveFieldLogDraft(entry.eventId, changes);
      if (!ok && !draftSaveFailedShownRef.current) {
        draftSaveFailedShownRef.current = true;
        setDraftSaveFailedNotice(true);
      }
    }, DRAFT_SAVE_DEBOUNCE_MS);
    return () => {
      if (draftSaveTimerRef.current) window.clearTimeout(draftSaveTimerRef.current);
    };
  }, [form, base, isEditing, entry.eventId]);

  useEffect(() => {
    return () => {
      if (noticeTimerRef.current) window.clearTimeout(noticeTimerRef.current);
    };
  }, []);

  const showNoticeThenClear = (text: string, ms: number) => {
    setSaveNotice(text);
    if (noticeTimerRef.current) window.clearTimeout(noticeTimerRef.current);
    noticeTimerRef.current = window.setTimeout(() => setSaveNotice(''), ms);
  };

  // 一覧・地図に古い値が残らないよう、ストア内の該当entryを更新する（再fetchはしない）
  const syncStore = (d: FieldEntryDetail) => {
    useZukanFieldStore.getState().updateEntry(entry.eventId, {
      foodName: d.food, place: d.place, memo: d.memo, date: d.date, kigo: d.kigo,
    });
  };

  // 編集開始。楽観ロックの基準（updated_at）を新しくするため、毎回D1の現在値を読み直す
  const beginEditing = async (draftChanges?: FieldLogDraftChanges) => {
    if (!idToken || !entry.eventId || isPreparing) return;
    setIsPreparing(true);
    setSaveError('');
    setSaveNotice('');
    setConflict(null);
    try {
      const [latest, opts] = await Promise.all([
        fetchFieldEntryDetail(entry.eventId, idToken),
        options ? Promise.resolve(options) : fetchFieldEditOptions(idToken),
      ]);
      setDetail(latest);
      setOptions(opts);
      const values = valuesFromDetail(latest);
      setBase(values);
      setForm({
        ...values,
        food: typeof draftChanges?.foodName === 'string' ? draftChanges.foodName : values.food,
        place: typeof draftChanges?.location === 'string' ? draftChanges.location : values.place,
        memo: typeof draftChanges?.memo === 'string' ? draftChanges.memo : values.memo,
      });
      pendingRequestRef.current = null;
      setShowUnsavedConfirm(false);
      draftSaveFailedShownRef.current = false;
      setDraftSaveFailedNotice(false);
      setDraftPrompt(null);
      setIsEditing(true);
    } catch (e) {
      setSaveError(handleError(e, '編集の準備ができませんでした。もう一度お試しください。'));
    } finally {
      setIsPreparing(false);
    }
  };

  const discardDraftPrompt = () => {
    if (entry.eventId) clearFieldLogDraft(entry.eventId);
    setDraftPrompt(null);
  };

  const handleBack = () => {
    if (!isEditing) {
      go(from);
      return;
    }
    if (!hasDiff) {
      setIsEditing(false);
      setConflict(null);
      return;
    }
    setShowUnsavedConfirm(true);
  };

  const discardAndStay = () => {
    if (entry.eventId) clearFieldLogDraft(entry.eventId);
    setForm(base);
    setSaveError('');
    setConflict(null);
    setShowUnsavedConfirm(false);
    setIsEditing(false);
  };

  const setField = <K extends keyof FieldEditValues>(key: K, value: FieldEditValues[K]) => {
    setForm((prev) => {
      if (!prev) return prev;
      const next = { ...prev, [key]: value };
      return key === 'large_category' && options ? adjustForLargeCategory(next, options) : next;
    });
  };

  const handleSave = async () => {
    if (isSaving || !idToken || !entry.eventId || !detail || !base || !form || hasErrors) return;
    if (!hasDiff) {
      setIsEditing(false);
      setConflict(null);
      return;
    }

    setIsSaving(true);
    setSaveError('');

    const key = JSON.stringify({ patch, expectedUpdatedAt: detail.updatedAt });
    if (pendingRequestRef.current?.key !== key) {
      pendingRequestRef.current = { key, requestId: crypto.randomUUID() };
    }
    const { requestId } = pendingRequestRef.current;

    try {
      const outcome = await patchFieldEntry(entry.eventId, { requestId, expectedUpdatedAt: detail.updatedAt, changes: patch }, idToken);
      pendingRequestRef.current = null;
      // 保存後の値（余市節気の再計算を含む）はD1から読み直して表示する
      const latest = await fetchFieldEntryDetail(entry.eventId, idToken).catch(() => null);
      if (latest) {
        setDetail(latest);
        setBase(valuesFromDetail(latest));
        setForm(valuesFromDetail(latest));
        syncStore(latest);
      }
      setIsEditing(false);
      setConflict(null);
      setShowUnsavedConfirm(false);
      clearFieldLogDraft(entry.eventId);
      setHistoryItems(null);
      if (outcome !== 'noChange') {
        showNoticeThenClear(latest ? '保存しました' : '保存しました。画面を開き直すと最新の内容が表示されます。', 4000);
      }
    } catch (e) {
      if (e instanceof FieldEditConflictError) {
        pendingRequestRef.current = null;
        try {
          const latest = await fetchFieldEntryDetail(entry.eventId, idToken);
          const rebased = rebaseAfterConflict(base, form, valuesFromDetail(latest));
          setDetail(latest);
          setBase(valuesFromDetail(latest));
          setForm(rebased.values);
          setConflict({ mine: rebased.mine, overlap: rebased.overlap });
          syncStore(latest);
          setHistoryItems(null);
        } catch (e2) {
          setSaveError(handleError(e2, '他の人が先にこの記録を更新しました。画面を開き直してください。'));
        }
      } else {
        setSaveError(handleError(e, '保存に失敗しました。もう一度お試しください。'));
      }
    } finally {
      setIsSaving(false);
    }
  };

  const toggleHistory = async () => {
    if (historyOpen) {
      setHistoryOpen(false);
      return;
    }
    setHistoryOpen(true);
    if (historyItems || !idToken || !entry.eventId) return;
    setHistoryLoading(true);
    setHistoryError('');
    try {
      setHistoryItems(historyForDisplay(await fetchFieldEntryHistory(entry.eventId, idToken)));
    } catch (e) {
      setHistoryError(handleError(e, '編集履歴を読み込めませんでした'));
    } finally {
      setHistoryLoading(false);
    }
  };

  const optionLabel = (field: FieldEditableField, value: string): string => {
    if (!value) return '—';
    const choices = options ? choicesFor(field, options, detail?.large_category ?? '', value) : [];
    return choices.find((c) => c.value === value)?.label ?? value;
  };

  const renderClassificationView = () => {
    if (!detail) return detailError ? <p className={styles.errorText}>{detailError}</p> : null;
    return (
      <dl className={styles.classGrid}>
        {CLASSIFICATION_FIELDS.map((f) => (
          <div key={f} className={styles.classRow}>
            <dt className={styles.classLabel}>{FIELD_LABELS[f]}</dt>
            <dd className={styles.classValue}>
              {f === 'observed_parts'
                ? (detail.observed_parts.length > 0 ? detail.observed_parts.join('・') : '—')
                : optionLabel(f, detail[f])}
            </dd>
          </div>
        ))}
      </dl>
    );
  };

  const renderClassificationEdit = () => {
    if (!form || !options || !base) return null;
    const partChoices = choicesFor('observed_parts', options, form.large_category, '');
    // 選択肢に無い古い観察部位も、チェックを外すまでは表示して残す
    for (const p of form.observed_parts) {
      if (!partChoices.some((c) => c.value === p)) partChoices.push({ value: p, label: p, inactive: true });
    }
    return (
      <div className={styles.classGrid}>
        {SELECT_FIELDS.map((f) => {
          const choices = choicesFor(f, options, form.large_category, form[f]);
          const allowEmpty = f === 'phase' || base[f] === '';
          return (
            <label key={f} className={styles.classRow}>
              <span className={styles.classLabel}>{FIELD_LABELS[f]}</span>
              <select
                className={styles.select}
                value={form[f]}
                onChange={(e) => setField(f, e.target.value)}
                disabled={isSaving}
              >
                {allowEmpty && <option value="">{f === 'phase' ? '未記録' : '未設定'}</option>}
                {choices.map((c) => (
                  <option key={c.value} value={c.value}>{c.inactive ? `${c.label}（今の値）` : c.label}</option>
                ))}
              </select>
            </label>
          );
        })}
        <fieldset className={styles.partsFieldset} disabled={isSaving}>
          <legend className={styles.classLabel}>{FIELD_LABELS.observed_parts}</legend>
          <div className={styles.partsRow}>
            {partChoices.map((c) => (
              <label key={c.value} className={styles.partChip}>
                <input
                  type="checkbox"
                  checked={form.observed_parts.includes(c.value)}
                  onChange={() => setField('observed_parts', toggleObservedPart(form.observed_parts, c.value))}
                />
                {c.inactive ? `${c.label}（今の値）` : c.label}
              </label>
            ))}
          </div>
        </fieldset>
      </div>
    );
  };

  const renderHistory = () => (
    <div className={styles.historyBox}>
      {historyLoading && <p className={styles.historyEmpty}>読み込み中…</p>}
      {historyError && <p className={styles.errorText}>{historyError}</p>}
      {historyItems && historyItems.length === 0 && <p className={styles.historyEmpty}>編集履歴はまだありません</p>}
      {historyItems && historyItems.length > 0 && (
        <ol className={styles.historyList}>
          {historyItems.map((it) => (
            <li key={it.id} className={styles.historyItem}>
              <p className={styles.historyMeta}>
                {formatHistoryTime(it.editedAt)}・{it.editedByName || it.editedBy}・{historySourceLabel(it)}
              </p>
              {it.reason && <p className={styles.historyReason}>{it.reason}</p>}
              <ul className={styles.historyChanges}>
                {it.changes.map((c) => (
                  <li key={c.field}>
                    <span className={styles.historyField}>{FIELD_LABELS[c.field] ?? c.field}</span>
                    {formatHistoryValue(c.old)} → {formatHistoryValue(c.new)}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ol>
      )}
    </div>
  );

  const handleVoid = async () => {
    if (!detail || !idToken || !entry.eventId || !voidReason.trim()) return;
    setIsVoiding(true);
    setVoidError('');
    // 通信断の後に押し直した時は同じ requestId（Worker が二重に無効化しない）
    voidRequestRef.current ??= crypto.randomUUID();
    try {
      const r = await voidFieldEntry(entry.eventId, { requestId: voidRequestRef.current, expectedUpdatedAt: detail.updatedAt, reason: voidReason.trim() }, idToken);
      voidRequestRef.current = null;
      setVoidOpen(false);
      setVoidReason('');
      // 一覧・地図から外す（次の取得でも API が除く）
      useZukanFieldStore.getState().removeEntry(entry.eventId);
      setDetail(await fetchFieldEntryDetail(entry.eventId, idToken).catch(() => ({ ...detail, status: 'voided' as const, voidReason: voidReason.trim() })));
      setSaveNotice(r.linkedSpotCount > 0
        ? `無効化しました。この記録は Environment Spot ${r.linkedSpotCount} 件の根拠になっていました（Spot と写真は残ります）`
        : '無効化しました');
    } catch (e) {
      if (e instanceof FieldEditConflictError) voidRequestRef.current = null;
      setVoidError(handleError(e, '無効化できませんでした。もう一度お試しください。'));
    } finally {
      setIsVoiding(false);
    }
  };

  const renderVoid = () => (
    <div className={styles.voidSection}>
      {!voidOpen ? (
        <button className={styles.voidBtn} onClick={() => { setVoidOpen(true); setVoidError(''); }} disabled={!detail}>この記録を無効化</button>
      ) : (
        <div className={styles.voidPanel} role="group" aria-label="記録の無効化">
          <p className={styles.voidTitle}>この記録を無効化しますか？</p>
          <p className={styles.voidText}>
            記録は消えず、図鑑・一覧・地図・新しい関連づけから外れます。理由と履歴が残り、管理者は元に戻せます。
            Environment Spot の根拠になっている場合も、Spot・写真・観察は残ります。Google Sheets の元の行も残り、「食材ログ_無効化」タブに記録されます。
          </p>
          <input
            className={styles.voidInput}
            value={voidReason}
            onChange={(e) => setVoidReason(e.target.value)}
            placeholder="理由（必須・履歴に残ります）例: 同じ発見の重複記録"
            maxLength={500}
            aria-label="無効化の理由"
          />
          {voidError && <p className={styles.errorText}>{voidError}</p>}
          <div className={styles.confirmBtns}>
            <button className={styles.continueBtn} onClick={() => { setVoidOpen(false); setVoidError(''); }} disabled={isVoiding}>やめる</button>
            <button className={styles.discardBtn} onClick={() => void handleVoid()} disabled={isVoiding || !voidReason.trim()}>
              {isVoiding ? '無効化中…' : '無効化する'}
            </button>
          </div>
        </div>
      )}
    </div>
  );

  return (
    <div className={styles.root}>
      <header className={styles.header}>
        <button className={styles.back} onClick={handleBack}>← 戻る</button>
        <span className={styles.title}>観察記録</span>
        {canEdit && !isEditing && !draftPrompt && (
          <button className={styles.editBtn} onClick={() => void beginEditing()} disabled={isPreparing}>
            {isPreparing ? '準備中…' : '編集'}
          </button>
        )}
        <HomeButton go={go} />
      </header>

      <main className={styles.main}>
        {isVoided && (
          <div className={styles.voidedBanner} role="status">
            <p className={styles.voidTitle}>この記録は無効化されています</p>
            <p className={styles.voidText}>
              {detail?.voidedAt ? `${formatHistoryTime(detail.voidedAt)}・` : ''}{detail?.voidedByName || ''}
              {detail?.voidReason ? `　理由: ${detail.voidReason}` : ''}
            </p>
            <p className={styles.voidText}>図鑑・一覧・地図には出ません。編集・Spot にする・関連づけはできません。</p>
          </div>
        )}
        <div className={styles.photoWrap}>
          {entry.photoUrl && entry.imageExpired
            ? <div className={styles.photoPlaceholder}>写真は再取得待ち（通信が戻ると表示されます）</div>
            : entry.photoUrl
              ? <img className={styles.photo} src={entry.photoUrl} alt={shown.food} />
              : <div className={styles.photoPlaceholder}>写真なし</div>}
        </div>

        {isEditing && conflict && (
          <div className={styles.conflictBanner} role="alert">
            <p className={styles.conflictTitle}>他の人が先にこの記録を更新しました</p>
            <p className={styles.conflictText}>
              最新の内容を読み込みました。
              {conflict.mine.length > 0 && `あなたが変更した項目（${fieldsText(conflict.mine)}）はそのまま残しています。`}
              確認して、もう一度保存してください。
            </p>
            {conflict.overlap.length > 0 && (
              <p className={styles.conflictText}>
                {fieldsText(conflict.overlap)}は他の人も変更しています。保存するとあなたの値で置き換わります。
              </p>
            )}
          </div>
        )}

        {isEditing && form ? (
          <div className={styles.foodNameEditWrap}>
            <span className={styles.editingTag}>編集中</span>
            <input
              ref={foodNameInputRef}
              className={styles.foodNameInput}
              value={form.food}
              onChange={(e) => setField('food', e.target.value)}
              placeholder="食材名を入力"
              aria-label="食材名"
              disabled={isSaving}
            />
            <span className={styles.requiredMark}>必須</span>
            {errors.food && <p className={styles.errorText}>{errors.food}</p>}
          </div>
        ) : (
          <h1 className={styles.foodName}>{shown.food || '無題'}</h1>
        )}
        {(detail?.subject_type ?? entry.subjectType) === '環境' && !isEditing && !isVoided && (
          <p className={styles.hintText}>
            🌲 環境の記録（Sheets・Notion には送りません）。
            {entry.environmentSpotId ? 'Environment Spot にしました。' : '地形探索の「記録」タブ →「Spot にする候補」から Environment Spot にできます。'}
          </p>
        )}

        {isEditing && form ? (
          <div className={styles.editMetaRow}>
            <input
              className={styles.locationInput}
              value={form.place}
              onChange={(e) => setField('place', e.target.value)}
              placeholder="場所を入力（任意）"
              aria-label="場所"
              disabled={isSaving}
            />
            <label className={styles.dateLabel}>
              観察日
              <input
                type="date"
                className={styles.dateInput}
                value={form.date}
                onChange={(e) => setField('date', e.target.value)}
                disabled={isSaving}
              />
            </label>
            {errors.date && <p className={styles.errorText}>{errors.date}</p>}
            {form.date !== base?.date && <p className={styles.hintText}>観察日を変えると、余市節気は保存時に自動で計算し直します</p>}
          </div>
        ) : (
          <div className={styles.metaRow}>
            <span className={styles.metaItem}>📍 {shown.place || '場所不明'}</span>
            <span className={styles.metaItem}>{shown.date}</span>
            {shown.kigo && <span className={styles.tag}>{shown.kigo}</span>}
          </div>
        )}

        {!isEditing && saveNotice && <p className={styles.saveNoticeTop}>{saveNotice}</p>}

        {!isEditing && saveError && <p className={styles.errorTextPad}>{saveError}</p>}

        {hasGps && !isEditing && (
          <Suspense fallback={null}>
            <FieldGpsMiniMap lat={entry.lat} lng={entry.lng} />
          </Suspense>
        )}

        {!isEditing && draftPrompt && canEdit && (
          <div className={styles.draftBanner}>
            <p className={styles.draftBannerTitle}>
              {isOldDraft(draftPrompt.savedAt) ? '古い下書きがあります' : '下書きがあります'}
              {formatDraftSavedAt(draftPrompt.savedAt) && `（${formatDraftSavedAt(draftPrompt.savedAt)}保存）`}
            </p>
            <div className={styles.draftBannerBtns}>
              <button className={styles.draftRestoreBtn} onClick={() => void beginEditing(draftPrompt.changes)} disabled={isPreparing}>
                下書きを復元
              </button>
              <button className={styles.draftDiscardBtn} onClick={discardDraftPrompt}>破棄して現在の記録を使う</button>
            </div>
          </div>
        )}

        {(canEdit || shown.memo) && (
          <div className={styles.memoBox}>
            <p className={styles.memoLabel}>観察内容</p>
            {isEditing && form ? (
              <>
                <textarea
                  className={styles.memoTextarea}
                  rows={6}
                  value={form.memo}
                  onChange={(e) => setField('memo', e.target.value)}
                  aria-label="観察内容"
                  disabled={isSaving}
                />
                {errors.memo && <p className={styles.errorText}>{errors.memo}</p>}
              </>
            ) : (
              <p className={styles.memoText}>{shown.memo || (canEdit ? 'メモはまだありません' : '')}</p>
            )}
          </div>
        )}

        {(detail || isEditing || detailError) && (
          <div className={styles.memoBox}>
            <p className={styles.memoLabel}>分類・状態</p>
            {isEditing ? renderClassificationEdit() : renderClassificationView()}
          </div>
        )}

        {!isEditing && (
          <div className={styles.linkRow}>
            <button
              className={styles.linkBtn}
              onClick={() => go({ name: 'zukanFieldMap', focusEntry: entry, from: { name: 'zukanFieldDetail', entry, from } })}
            >
              📍 地図で見る
            </button>
            {hasGps && (
              <a className={styles.linkBtn} href={buildDirectionsUrl(entry.lat, entry.lng)} target="_blank" rel="noreferrer">
                🧭 経路案内
              </a>
            )}
            {canEditBase && (
              <button className={styles.linkBtn} onClick={() => void toggleHistory()} aria-expanded={historyOpen}>
                🕘 編集履歴{historyOpen ? 'を閉じる' : ''}
              </button>
            )}
            {entry.notionUrl && (
              <a className={styles.linkBtn} href={entry.notionUrl} target="_blank" rel="noreferrer">
                📝 Notionで開く
              </a>
            )}
          </div>
        )}

        {!isEditing && historyOpen && renderHistory()}

        {/* 訂正のボタンとは別の行・注意の色（Work Log の無効化と同じ）。管理者だけ */}
        {isAdmin && !isEditing && !isVoided && renderVoid()}
      </main>

      {isEditing && (
        <footer className={styles.footer}>
          {showUnsavedConfirm ? (
            <div className={styles.confirmRow}>
              <p className={styles.confirmText}>保存されていない変更があります</p>
              <div className={styles.confirmBtns}>
                <button className={styles.continueBtn} onClick={() => setShowUnsavedConfirm(false)}>編集を続ける</button>
                <button className={styles.discardBtn} onClick={discardAndStay}>変更を破棄する</button>
              </div>
            </div>
          ) : (
            <>
              {draftSaveFailedNotice && (
                <p className={styles.draftWarningText}>
                  この端末では下書きを保存できません。
                  通信が不安定な場所では画面を閉じないでください。
                </p>
              )}
              {hasDiff && <p className={styles.hintText}>変更する項目: {fieldsText(Object.keys(patch) as FieldEditableField[])}</p>}
              {saveError && <p className={styles.errorText}>{saveError}</p>}
              <button className={styles.saveBtn} disabled={isSaving || hasErrors} onClick={() => void handleSave()}>
                {isSaving ? '保存中…' : hasDiff ? '保存' : '変更なし（閉じる）'}
              </button>
            </>
          )}
        </footer>
      )}
    </div>
  );
}
