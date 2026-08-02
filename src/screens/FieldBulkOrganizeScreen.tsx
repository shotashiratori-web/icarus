import { useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useZukanFieldStore } from '../store/zukanFieldStore';
import { updateFieldLogEntry, deleteFieldLogEntries, type FieldUpdateEntryChanges } from '../api/zukanApi';
import { TokenExpiredError } from '../api/icarusApi';
import { validateFoodName } from '../utils/foodNameValidation';
import { isBulkPhotoIncomplete, countFieldIncomplete } from '../utils/fieldIncomplete';
import {
  loadFieldLogDraft,
  saveFieldLogDraft,
  clearFieldLogDraft,
  isOldDraft,
  formatDraftSavedAt,
  type FieldLogDraft,
  type FieldLogDraftChanges,
} from '../utils/fieldLogDraft';
import type { Screen } from '../App';
import styles from './FieldBulkOrganizeScreen.module.css';

type Props = { go: (s: Screen) => void; from: Screen };
type NavAction = 'prev' | 'next' | 'skip';

const DRAFT_SAVE_DEBOUNCE_MS = 800;

export default function FieldBulkOrganizeScreen({ go, from }: Props) {
  const { idToken, staffMe, handleTokenExpired } = useAuth();
  const canEdit = staffMe?.role === 'admin';
  const { entries, loadState, errorMessage, ensureLoaded, reload } = useZukanFieldStore();

  // セッション開始時に対象EventIDを固定する。以降このセッション中は保存が進んでも分母・順序を変えない
  const [snapshotIds, setSnapshotIds] = useState<string[] | null>(null);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [skippedIds, setSkippedIds] = useState<Set<string>>(new Set());

  const [originalFoodName, setOriginalFoodName] = useState('');
  const [draftFoodName, setDraftFoodName] = useState('');
  // 場所・メモは任意。過去写真で内容を覚えていない場合まで無理に埋めさせない方針は変えず、
  // 「覚えているならここで一緒に書きたい」場合にだけ使ってもらう追加項目として扱う
  const [originalLocation, setOriginalLocation] = useState('');
  const [draftLocation, setDraftLocation] = useState('');
  const [originalMemo, setOriginalMemo] = useState('');
  const [draftMemo, setDraftMemo] = useState('');
  const [draftPrompt, setDraftPrompt] = useState<FieldLogDraft | null>(null);
  const [pendingNavAction, setPendingNavAction] = useState<NavAction | null>(null);

  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [saveNotice, setSaveNotice] = useState('');
  const [draftSaveFailedNotice, setDraftSaveFailedNotice] = useState(false);

  // 食材として同定不能な写真（メモ書きの誤混入等）をその場で削除するための状態
  const [deleteConfirming, setDeleteConfirming] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');

  // 通信が不安定な現場での利用を想定し、写真の読み込み中・失敗を明示する
  // （枠の背景色が画面背景と近く、何もフィードバックがないと「壊れている」ように見えるため）
  const [photoLoadState, setPhotoLoadState] = useState<'loading' | 'loaded' | 'error'>('loading');
  const [photoRetryKey, setPhotoRetryKey] = useState(0);

  const foodNameInputRef = useRef<HTMLInputElement>(null);
  const noticeTimerRef = useRef<number | null>(null);
  const draftSaveTimerRef = useRef<number | null>(null);
  // 「保存できません」警告はこの画面を開いている間（複数枚をまたいで）1回だけ出す
  const draftSaveFailedShownRef = useRef(false);

  useEffect(() => { void ensureLoaded(); }, [ensureLoaded]);

  useEffect(() => {
    if (snapshotIds !== null || loadState !== 'ready') return;
    const ids = entries
      .filter(isBulkPhotoIncomplete)
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((e) => e.eventId)
      .filter((id) => !!id);
    setSnapshotIds(ids);
  }, [loadState, entries, snapshotIds]);

  const currentEventId = snapshotIds && currentIndex < snapshotIds.length ? snapshotIds[currentIndex] : null;
  const currentEntry = useMemo(
    () => (currentEventId ? entries.find((e) => e.eventId === currentEventId) ?? null : null),
    [entries, currentEventId],
  );

  // 写真が切り替わるたびに、編集状態と下書き確認をその写真のものへ入れ替える
  useEffect(() => {
    if (!currentEntry) return;
    setOriginalFoodName(currentEntry.foodName);
    setDraftFoodName(currentEntry.foodName);
    setOriginalLocation(currentEntry.place);
    setDraftLocation(currentEntry.place);
    setOriginalMemo(currentEntry.memo);
    setDraftMemo(currentEntry.memo);
    setSaveError('');
    setSaveNotice('');
    setPendingNavAction(null);
    setDeleteConfirming(false);
    setDeleteError('');
    setPhotoLoadState('loading');
    setPhotoRetryKey(0);

    const draft = loadFieldLogDraft(currentEntry.eventId);
    const c = draft?.changes;
    const differs = !!c && (
      (typeof c.foodName === 'string' && c.foodName !== currentEntry.foodName) ||
      (typeof c.location === 'string' && c.location !== currentEntry.place) ||
      (typeof c.memo === 'string' && c.memo !== currentEntry.memo)
    );
    setDraftPrompt(differs ? draft! : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentEventId]);

  useEffect(() => {
    if (!draftPrompt && currentEntry && foodNameInputRef.current) {
      foodNameInputRef.current.focus();
    }
  }, [currentEventId, draftPrompt, currentEntry]);

  // 入力後800msでその写真専用の下書きを保存する（既存Unit D-1と同じキー・同じ仕組みを本画面でも明示的に実装）
  useEffect(() => {
    if (!currentEntry) return;
    if (draftSaveTimerRef.current) window.clearTimeout(draftSaveTimerRef.current);
    draftSaveTimerRef.current = window.setTimeout(() => {
      const changes: FieldLogDraftChanges = {};
      if (draftFoodName !== originalFoodName) changes.foodName = draftFoodName;
      if (draftLocation !== originalLocation) changes.location = draftLocation;
      if (draftMemo !== originalMemo) changes.memo = draftMemo;

      if (Object.keys(changes).length === 0) {
        clearFieldLogDraft(currentEntry.eventId);
        return;
      }
      const ok = saveFieldLogDraft(currentEntry.eventId, changes);
      if (!ok && !draftSaveFailedShownRef.current) {
        draftSaveFailedShownRef.current = true;
        setDraftSaveFailedNotice(true);
      }
    }, DRAFT_SAVE_DEBOUNCE_MS);
    return () => {
      if (draftSaveTimerRef.current) window.clearTimeout(draftSaveTimerRef.current);
    };
  }, [draftFoodName, draftLocation, draftMemo, originalFoodName, originalLocation, originalMemo, currentEntry]);

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

  const foodNameError = validateFoodName(draftFoodName);
  const hasDiff = draftFoodName !== originalFoodName || draftLocation !== originalLocation || draftMemo !== originalMemo;

  const total = snapshotIds?.length ?? 0;
  const position = Math.min(currentIndex + 1, total);
  const remaining = useMemo(() => countFieldIncomplete(entries).bulkPhoto, [entries]);
  const isDone = snapshotIds !== null && currentIndex >= snapshotIds.length;

  const restoreDraft = () => {
    if (!draftPrompt) return;
    const c = draftPrompt.changes;
    setDraftFoodName(typeof c.foodName === 'string' ? c.foodName : originalFoodName);
    setDraftLocation(typeof c.location === 'string' ? c.location : originalLocation);
    setDraftMemo(typeof c.memo === 'string' ? c.memo : originalMemo);
    setDraftPrompt(null);
  };

  const discardDraftPrompt = () => {
    if (currentEntry) clearFieldLogDraft(currentEntry.eventId);
    setDraftPrompt(null);
  };

  const doNav = (action: NavAction) => {
    if (action === 'skip' && currentEntry) {
      setSkippedIds((prev) => new Set(prev).add(currentEntry.eventId));
    }
    setCurrentIndex((i) => {
      if (action === 'prev') return Math.max(0, i - 1);
      return Math.min(total, i + 1);
    });
    setPendingNavAction(null);
  };

  // 未保存の食材名がある状態で前へ／後で整理／保存せず次へ、を押した場合に静かに失わないための確認。
  // 確認を出す前に必ず下書きへスナップショット保存しておく（確認中に閉じられても保護されるように）
  const attemptNav = (action: NavAction) => {
    if (!currentEntry || !hasDiff) {
      doNav(action);
      return;
    }
    const changes: FieldLogDraftChanges = {};
    if (draftFoodName !== originalFoodName) changes.foodName = draftFoodName;
    if (draftLocation !== originalLocation) changes.location = draftLocation;
    if (draftMemo !== originalMemo) changes.memo = draftMemo;
    const ok = saveFieldLogDraft(currentEntry.eventId, changes);
    if (!ok && !draftSaveFailedShownRef.current) {
      draftSaveFailedShownRef.current = true;
      setDraftSaveFailedNotice(true);
    }
    setPendingNavAction(action);
  };

  const handleSaveAndNext = async () => {
    if (isSaving || !idToken || !currentEntry?.eventId || foodNameError) return;
    setIsSaving(true);
    setSaveError('');

    const changes: FieldUpdateEntryChanges = {};
    if (draftFoodName !== originalFoodName) changes.foodName = draftFoodName;
    if (draftLocation !== originalLocation) changes.location = draftLocation;
    if (draftMemo !== originalMemo) changes.memo = draftMemo;

    const draftOk = saveFieldLogDraft(currentEntry.eventId, changes);
    if (!draftOk && !draftSaveFailedShownRef.current) {
      draftSaveFailedShownRef.current = true;
      setDraftSaveFailedNotice(true);
    }

    try {
      const result = await updateFieldLogEntry(currentEntry.eventId, changes, idToken);
      clearFieldLogDraft(currentEntry.eventId);
      useZukanFieldStore.getState().updateEntry(currentEntry.eventId, result.entry);
      if (!result.noChange) {
        showNoticeThenClear(
          result.warning ? '保存されました。外部データへの反映が一部完了していません。' : '保存しました',
          result.warning ? 5000 : 4000,
        );
      }
      // 保存成功後は保護すべき未保存入力が残らないため、確認なしでそのまま次へ進む
      doNav('next');
    } catch (e) {
      if (e instanceof TokenExpiredError) handleTokenExpired();
      // API失敗時は現在位置・入力内容を維持する（下書きは既に保存済み）
      setSaveError(e instanceof Error ? e.message : '保存に失敗しました。もう一度お試しください。');
    } finally {
      setIsSaving(false);
    }
  };

  // 食材として同定できない写真（メモ書きの誤混入等）をSheetsから削除する。管理者限定・元に戻せない
  const handleDelete = async () => {
    if (isDeleting || !idToken || !currentEntry?.eventId) return;
    setIsDeleting(true);
    setDeleteError('');
    try {
      await deleteFieldLogEntries([currentEntry.eventId], idToken);
      clearFieldLogDraft(currentEntry.eventId);
      useZukanFieldStore.getState().removeEntry(currentEntry.eventId);
      setDeleteConfirming(false);
      doNav('next');
    } catch (e) {
      if (e instanceof TokenExpiredError) handleTokenExpired();
      setDeleteError(e instanceof Error ? e.message : '削除に失敗しました。もう一度お試しください。');
    } finally {
      setIsDeleting(false);
    }
  };

  const hasGps = !!currentEntry && Number.isFinite(currentEntry.lat) && Number.isFinite(currentEntry.lng)
    && !(currentEntry.lat === 0 && currentEntry.lng === 0);

  if (loadState === 'loading' || snapshotIds === null) {
    return (
      <div className={styles.root}>
        <header className={styles.header}>
          <button className={styles.back} onClick={() => go(from)}>← 戻る</button>
          <span className={styles.title}>📷 一括写真の整理</span>
        </header>
        <div className={styles.centerMessage}>読み込み中…</div>
      </div>
    );
  }

  if (loadState === 'error') {
    return (
      <div className={styles.root}>
        <header className={styles.header}>
          <button className={styles.back} onClick={() => go(from)}>← 戻る</button>
          <span className={styles.title}>📷 一括写真の整理</span>
        </header>
        <div className={styles.centerMessage}>
          <p className={styles.errorText}>{errorMessage}</p>
          <button className={styles.retryBtn} onClick={() => reload()}>再読み込み</button>
        </div>
      </div>
    );
  }

  if (total === 0) {
    return (
      <div className={styles.root}>
        <header className={styles.header}>
          <button className={styles.back} onClick={() => go(from)}>← 戻る</button>
          <span className={styles.title}>📷 一括写真の整理</span>
        </header>
        <div className={styles.centerMessage}>整理が必要な写真はありません。</div>
      </div>
    );
  }

  return (
    <div className={styles.root}>
      <header className={styles.header}>
        <button className={styles.back} onClick={() => go(from)}>← 戻る</button>
        <span className={styles.title}>📷 一括写真の整理</span>
      </header>

      <div className={styles.progressRow}>
        <span className={styles.progressText}>{isDone ? total : position} / {total}</span>
        <span className={styles.remainingText}>残り{remaining}件</span>
      </div>

      <main className={styles.main}>
        {isDone && (
          <div className={styles.doneBox}>
            <p className={styles.doneTitle}>今回の対象は以上です</p>
            <p className={styles.doneSub}>残り{remaining}件は、次回この画面を開いたときに続きから対象になります。</p>
            <button className={styles.doneBackBtn} onClick={() => go(from)}>入口へ戻る</button>
          </div>
        )}

        {!isDone && !currentEntry && (
          <div className={styles.centerMessage}>
            <p>この記録は見つかりませんでした（削除済みの可能性があります）。</p>
            <button className={styles.doneBackBtn} onClick={() => doNav('next')}>次へ</button>
          </div>
        )}

        {!isDone && currentEntry && (
          <>
            <div className={styles.photoWrap}>
              {currentEntry.photoUrl ? (
                <>
                  {photoLoadState !== 'loaded' && (
                    <div className={styles.photoStatus}>
                      {photoLoadState === 'error' ? (
                        <>
                          <p>写真を読み込めませんでした</p>
                          <p className={styles.photoStatusSub}>通信状況を確認してください</p>
                          <button
                            className={styles.photoRetryBtn}
                            onClick={() => { setPhotoLoadState('loading'); setPhotoRetryKey((k) => k + 1); }}
                          >
                            再読み込み
                          </button>
                        </>
                      ) : (
                        <p>読み込み中…</p>
                      )}
                    </div>
                  )}
                  <img
                    key={photoRetryKey}
                    className={styles.photo}
                    src={currentEntry.photoUrl}
                    alt=""
                    style={photoLoadState === 'loaded' ? undefined : { display: 'none' }}
                    onLoad={() => setPhotoLoadState('loaded')}
                    onError={() => setPhotoLoadState('error')}
                  />
                </>
              ) : (
                <div className={styles.photoPlaceholder}>写真なし</div>
              )}
            </div>

            <div className={styles.infoRow}>
              <span className={styles.dateText}>📅 {currentEntry.date}</span>
              <span className={styles.gpsText}>
                {hasGps ? `📍 GPSあり（緯度 ${currentEntry.lat.toFixed(5)}, 経度 ${currentEntry.lng.toFixed(5)}）` : '📍 GPSなし'}
              </span>
              {skippedIds.has(currentEntry.eventId) && (
                <span className={styles.skippedTag}>今回すでに「後で整理」を選んだ写真です</span>
              )}
            </div>

            {draftPrompt && (
              <div className={styles.draftBanner}>
                <p className={styles.draftBannerTitle}>
                  {isOldDraft(draftPrompt.savedAt) ? '古い下書きがあります' : '下書きがあります'}
                  {formatDraftSavedAt(draftPrompt.savedAt) && `（${formatDraftSavedAt(draftPrompt.savedAt)}保存）`}
                </p>
                <div className={styles.draftBannerBtns}>
                  <button className={styles.draftRestoreBtn} onClick={restoreDraft}>下書きを復元</button>
                  <button className={styles.draftDiscardBtn} onClick={discardDraftPrompt}>破棄して現在の記録を使う</button>
                </div>
              </div>
            )}

            {canEdit ? (
              <div className={styles.formBox}>
                <label className={styles.foodNameLabel}>食材名 <span className={styles.requiredMark}>必須</span></label>
                <input
                  ref={foodNameInputRef}
                  className={styles.foodNameInput}
                  value={draftFoodName}
                  onChange={(e) => setDraftFoodName(e.target.value)}
                  placeholder="食材名を入力"
                  disabled={isSaving}
                />
                {foodNameError && <p className={styles.errorText}>{foodNameError}</p>}

                <label className={styles.fieldLabel}>場所（任意）</label>
                <input
                  className={styles.locationInput}
                  value={draftLocation}
                  onChange={(e) => setDraftLocation(e.target.value)}
                  placeholder="覚えていれば入力"
                  disabled={isSaving}
                />

                <label className={styles.fieldLabel}>メモ（任意）</label>
                <textarea
                  className={styles.memoTextarea}
                  rows={4}
                  value={draftMemo}
                  onChange={(e) => setDraftMemo(e.target.value)}
                  placeholder="気づいたこと・状況など、覚えていれば入力"
                  disabled={isSaving}
                />

                {draftSaveFailedNotice && (
                  <p className={styles.draftWarningText}>
                    この端末では下書きを保存できません。通信が不安定な場所では画面を閉じないでください。
                  </p>
                )}
                {saveError && <p className={styles.errorText}>{saveError}</p>}
                {saveNotice && <p className={styles.saveNotice}>{saveNotice}</p>}

                {pendingNavAction ? (
                  <div className={styles.confirmRow}>
                    <p className={styles.confirmText}>
                      保存されていない入力があります（下書きとして保護されています）
                    </p>
                    <div className={styles.confirmBtns}>
                      <button className={styles.continueBtn} onClick={() => setPendingNavAction(null)}>入力を続ける</button>
                      <button className={styles.discardBtn} onClick={() => doNav(pendingNavAction)}>このまま進む</button>
                    </div>
                  </div>
                ) : deleteConfirming ? (
                  <div className={styles.confirmRow}>
                    <p className={styles.confirmText}>
                      この写真を削除しますか？（Sheetsの行を削除します。元に戻せません）
                    </p>
                    {deleteError && <p className={styles.errorText}>{deleteError}</p>}
                    <div className={styles.confirmBtns}>
                      <button className={styles.continueBtn} onClick={() => setDeleteConfirming(false)} disabled={isDeleting}>
                        キャンセル
                      </button>
                      <button className={styles.discardBtn} onClick={() => void handleDelete()} disabled={isDeleting}>
                        {isDeleting ? '削除中…' : '削除する'}
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className={styles.actionRow}>
                      <button className={styles.prevBtn} onClick={() => attemptNav('prev')} disabled={currentIndex === 0}>
                        ← 前へ
                      </button>
                      <button className={styles.skipBtn} onClick={() => attemptNav('skip')}>後で整理</button>
                      <button
                        className={styles.saveBtn}
                        onClick={() => void handleSaveAndNext()}
                        disabled={isSaving || !!foodNameError}
                      >
                        {isSaving ? '保存中…' : '保存して次へ'}
                      </button>
                    </div>
                    <button className={styles.deleteLinkBtn} onClick={() => setDeleteConfirming(true)}>
                      🗑 フィールドログ対象外として削除する（料理・メモ書きなど）
                    </button>
                  </>
                )}
              </div>
            ) : (
              <p className={styles.readOnlyNote}>編集は管理者のみ利用できます。</p>
            )}
          </>
        )}
      </main>
    </div>
  );
}
