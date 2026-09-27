import { useEffect, useState } from 'react';
import { createWine, fetchWine, patchWine, WineValidationError } from '../api/wineEntityApi';
import { NetworkUnknownError } from '../api/workApi';
import { TokenExpiredError } from '../api/icarusApi';
import { EditConflictError, editErrorMessage } from '../api/editErrors';
import { useAuth } from '../context/AuthContext';
import type { WineEntity, WineFormInput } from '../types/wineEntity';
import type { Screen } from '../App';
import HomeButton from '../components/HomeButton';
import EditFooter from '../components/edit/EditFooter';
import ConflictBanner from '../components/edit/ConflictBanner';
import { rebaseByKeys } from '../utils/editCore';
import { usePendingRequestId } from '../utils/usePendingRequestId';
import {
  WINE_EDIT_KEYS, WINE_FORM_LABELS, changedWineKeys, validateWineForm, valuesFromWine, wineChangesFromForm, wineEquals,
  type WineEditValues,
} from '../utils/wineEdit';
import styles from './WineFormScreen.module.css';

type Props = { go: (s: Screen) => void } & (
  | { mode: 'create' }
  | { mode: 'edit'; wine: WineEntity }
);

const EMPTY: WineEditValues = { photoUrl: '', title: '', producer: '', vintage: '', variety: '', origin: '', description: '' };

// Wine Editing（2026-09-28）: 編集は共通 API 契約の PATCH（変えた項目だけ・編集開始時の updated_at・requestId）。
// 409 は最新を読み直して自分の入力を残す（自動では再保存しない）。無効化（archive）は admin だけ。
// 物理削除は画面に出さない（note の紐づけが外れ、履歴が残らないため）。作成は従来どおり POST
export default function WineFormScreen(props: Props) {
  const { go, mode } = props;
  const { idToken, staffMe, handleTokenExpired } = useAuth();
  const canArchive = staffMe?.role === 'admin';

  // 編集: サーバーの最新（updated_at の基準）。作成: null
  const [current, setCurrent] = useState<WineEntity | null>(mode === 'edit' ? props.wine : null);
  const [base, setBase] = useState<WineEditValues>(mode === 'edit' ? valuesFromWine(props.wine) : EMPTY);
  const [form, setForm] = useState<WineEditValues>(mode === 'edit' ? valuesFromWine(props.wine) : EMPTY);
  const [loadingLatest, setLoadingLatest] = useState(mode === 'edit');
  const [saving, setSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [conflict, setConflict] = useState<{ mine: string[]; overlap: string[] } | null>(null);
  const [showUnsavedConfirm, setShowUnsavedConfirm] = useState(false);
  const [confirmingArchive, setConfirmingArchive] = useState(false);
  const pending = usePendingRequestId();

  const handleError = (e: unknown, fallback: string): string => {
    if (e instanceof TokenExpiredError) handleTokenExpired();
    if (e instanceof WineValidationError || e instanceof NetworkUnknownError) return e.message;
    return editErrorMessage(e, fallback);
  };

  // 一覧から渡された値は古いことがあるので、編集開始時にサーバーの最新（updated_at）を読み直す
  const editId = mode === 'edit' ? props.wine.id : null;
  useEffect(() => {
    if (!editId || !idToken) return;
    let cancelled = false;
    fetchWine(editId, idToken)
      .then((w) => {
        if (cancelled) return;
        setCurrent(w);
        setBase(valuesFromWine(w));
        setForm(valuesFromWine(w));
      })
      .catch((e) => { if (!cancelled) setErrorMessage(handleError(e, '最新の内容を読み込めませんでした')); })
      .finally(() => { if (!cancelled) setLoadingLatest(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editId, idToken]);

  const setField = (key: keyof WineEditValues, value: string) => setForm((prev) => ({ ...prev, [key]: value }));
  const changedLabels = changedWineKeys(base, form).map((k) => WINE_FORM_LABELS[k]);
  const validation = validateWineForm(form);

  const backToList = () => go({ name: 'wineList' });
  const leave = () => {
    if (mode === 'edit' && current) go({ name: 'wineDetail', entry: current });
    else backToList();
  };
  const tryLeave = () => {
    if (changedLabels.length > 0) setShowUnsavedConfirm(true);
    else leave();
  };

  const handleCreate = async () => {
    if (!idToken) return;
    if (validation) {
      setErrorMessage(validation);
      return;
    }
    const input: WineFormInput = {
      title: form.title.trim(),
      description: form.description.trim(),
      photos: form.photoUrl.trim() ? [form.photoUrl.trim()] : [],
      tags: [],
      producer: form.producer.trim(),
      vintage: form.vintage.trim() ? Number(form.vintage.trim()) : null,
      variety: form.variety.trim(),
      origin: form.origin.trim(),
    };
    setSaving(true);
    setErrorMessage('');
    try {
      await createWine(input, idToken);
      backToList();
    } catch (e) {
      setErrorMessage(handleError(e, '保存に失敗しました'));
    } finally {
      setSaving(false);
    }
  };

  const handleSave = async () => {
    if (!idToken || !current || validation || saving) return;
    const changes = wineChangesFromForm(base, form, current.photos);
    if (Object.keys(changes).length === 0) {
      leave();
      return;
    }
    const expectedUpdatedAt = current.updatedAt;
    const requestId = pending.requestIdFor(JSON.stringify({ changes, expectedUpdatedAt }));
    setSaving(true);
    setErrorMessage('');
    try {
      await patchWine(current.id, { requestId, expectedUpdatedAt, changes }, idToken);
      pending.clear();
      const latest = await fetchWine(current.id, idToken).catch(() => null);
      go({ name: 'wineDetail', entry: latest ?? current });
    } catch (e) {
      if (e instanceof EditConflictError) {
        // 他の人が先に保存した: 最新を読み、自分が変えた項目は入力のまま残す。自動では再保存しない
        pending.clear();
        try {
          const latestWine = await fetchWine(current.id, idToken);
          const latest = valuesFromWine(latestWine);
          const rebased = rebaseByKeys(WINE_EDIT_KEYS, base, form, latest, wineEquals);
          setCurrent(latestWine);
          setBase(latest);
          setForm(rebased.values);
          setConflict({
            mine: rebased.mine.map((k) => WINE_FORM_LABELS[k]),
            overlap: rebased.overlap.map((k) => WINE_FORM_LABELS[k]),
          });
        } catch (e2) {
          setErrorMessage(handleError(e2, '他の人が先に更新しました。画面を開き直してください。'));
        }
      } else {
        setErrorMessage(handleError(e, '保存に失敗しました。もう一度お試しください。'));
      }
    } finally {
      setSaving(false);
    }
  };

  // admin: 無効化（archive）。一覧から見えなくなる。物理削除はしない（履歴に残る）
  const handleArchive = async () => {
    if (!idToken || !current || !canArchive || saving) return;
    setSaving(true);
    setErrorMessage('');
    try {
      await patchWine(current.id, { requestId: crypto.randomUUID(), expectedUpdatedAt: current.updatedAt, changes: { status: 'archived' } }, idToken);
      backToList();
    } catch (e) {
      setErrorMessage(e instanceof EditConflictError
        ? '他の人が先に更新しました。画面を開き直してから無効化してください。'
        : handleError(e, '無効化に失敗しました'));
      setConfirmingArchive(false);
    } finally {
      setSaving(false);
    }
  };

  const busy = saving || loadingLatest;

  return (
    <div className={styles.root}>
      <header className={styles.header}>
        <button className={styles.back} onClick={mode === 'edit' ? tryLeave : backToList}>
          {mode === 'edit' ? '← 戻る' : '← ワイン一覧'}
        </button>
        <span className={styles.title}>{mode === 'edit' ? 'ワインを編集' : 'ワインを追加'}</span>
        <HomeButton go={go} />
      </header>

      <main className={styles.main}>
        {mode === 'edit' && conflict && <ConflictBanner mineLabels={conflict.mine} overlapLabels={conflict.overlap} />}

        <div className={styles.photoWrap}>
          {form.photoUrl
            ? <img className={styles.photo} src={form.photoUrl} alt="" />
            : <div className={styles.photoPlaceholder}>🍷</div>}
        </div>
        <label className={styles.field}>
          <span className={styles.label}>写真URL</span>
          <input className={styles.input} type="text" value={form.photoUrl} onChange={(e) => setField('photoUrl', e.target.value)} placeholder="https://..." disabled={busy} />
        </label>

        <label className={styles.field}>
          <span className={styles.label}>ワイン名 *</span>
          <input className={styles.input} type="text" value={form.title} onChange={(e) => setField('title', e.target.value)} placeholder="ワイン名" disabled={busy} />
        </label>

        <div className={styles.row}>
          <label className={styles.field}>
            <span className={styles.label}>生産者</span>
            <input className={styles.input} type="text" value={form.producer} onChange={(e) => setField('producer', e.target.value)} disabled={busy} />
          </label>
          <label className={styles.field}>
            <span className={styles.label}>ヴィンテージ</span>
            <input className={styles.input} type="number" value={form.vintage} onChange={(e) => setField('vintage', e.target.value)} placeholder="例: 2021" disabled={busy} />
          </label>
        </div>

        <div className={styles.row}>
          <label className={styles.field}>
            <span className={styles.label}>品種</span>
            <input className={styles.input} type="text" value={form.variety} onChange={(e) => setField('variety', e.target.value)} disabled={busy} />
          </label>
          <label className={styles.field}>
            <span className={styles.label}>産地</span>
            <input className={styles.input} type="text" value={form.origin} onChange={(e) => setField('origin', e.target.value)} disabled={busy} />
          </label>
        </div>

        <label className={styles.field}>
          <span className={styles.label}>メモ</span>
          <textarea className={styles.textarea} value={form.description} onChange={(e) => setField('description', e.target.value)} rows={4} disabled={busy} />
        </label>

        {mode === 'create' ? (
          <>
            {errorMessage && <p className={styles.errorText}>{errorMessage}</p>}
            <div className={styles.actions}>
              <button className={styles.saveBtn} disabled={saving} onClick={() => void handleCreate()}>
                {saving ? '保存中…' : '保存する'}
              </button>
            </div>
          </>
        ) : (
          <div className={styles.actions}>
            {loadingLatest && <p className={styles.confirmText}>最新の内容を読み込み中…</p>}
            <EditFooter
              changedLabels={changedLabels}
              isSaving={saving}
              canSave={!validation && !loadingLatest}
              errorMessage={errorMessage || (changedLabels.length > 0 ? validation : '') || undefined}
              onSave={() => void handleSave()}
              onClose={leave}
              showUnsavedConfirm={showUnsavedConfirm}
              onContinueEditing={() => setShowUnsavedConfirm(false)}
              onDiscard={leave}
            />
            {/* 無効化（archive）は admin だけ。一覧から見えなくなる。履歴に残り、admin が戻せる */}
            {canArchive && !showUnsavedConfirm && !confirmingArchive && (
              <button className={styles.deleteBtn} disabled={busy} onClick={() => setConfirmingArchive(true)}>
                このワインを無効化
              </button>
            )}
            {canArchive && confirmingArchive && (
              <div className={styles.confirmRow}>
                <span className={styles.confirmText}>無効化すると一覧から見えなくなります（履歴に残り、戻せます）</span>
                <button className={styles.deleteBtn} disabled={saving} onClick={() => void handleArchive()}>
                  {saving ? '無効化中…' : '無効化する'}
                </button>
                <button className={styles.cancelBtn} disabled={saving} onClick={() => setConfirmingArchive(false)}>
                  キャンセル
                </button>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
