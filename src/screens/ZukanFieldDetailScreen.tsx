import { useEffect, useRef, useState } from 'react';
import type { FieldLogEntry } from '../types/zukan';
import type { Screen } from '../App';
import { useAuth } from '../context/AuthContext';
import { useZukanFieldStore } from '../store/zukanFieldStore';
import { updateFieldLogEntry, type FieldUpdateEntryChanges } from '../api/zukanApi';
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
import { validateFoodName } from '../utils/foodNameValidation';
import styles from './ZukanFieldDetailScreen.module.css';

type Props = { go: (s: Screen) => void; entry: FieldLogEntry; from: Screen };

const DRAFT_SAVE_DEBOUNCE_MS = 800;

export default function ZukanFieldDetailScreen({ go, entry, from }: Props) {
  const { idToken, staffMe, handleTokenExpired } = useAuth();
  const canEdit = staffMe?.role === 'admin' && !!entry.eventId;

  const [originalFoodName, setOriginalFoodName] = useState(entry.foodName);
  const [draftFoodName, setDraftFoodName] = useState(entry.foodName);
  const [originalLocation, setOriginalLocation] = useState(entry.place);
  const [draftLocation, setDraftLocation] = useState(entry.place);
  const [originalMemo, setOriginalMemo] = useState(entry.memo);
  const [draftMemo, setDraftMemo] = useState(entry.memo);

  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [saveNotice, setSaveNotice] = useState('');
  const [showUnsavedConfirm, setShowUnsavedConfirm] = useState(false);
  const [draftPrompt, setDraftPrompt] = useState<FieldLogDraft | null>(null);
  const [draftSaveFailedNotice, setDraftSaveFailedNotice] = useState(false);

  const foodNameInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const noticeTimerRef = useRef<number | null>(null);
  const draftSaveTimerRef = useRef<number | null>(null);
  const draftSaveFailedShownRef = useRef(false);

  const foodNameError = isEditing ? validateFoodName(draftFoodName) : '';

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

  // 編集開始時のフォーカス：食材名が未入力（「無題」表示）なら食材名を、そうでなければメモ欄末尾を選ぶ
  useEffect(() => {
    if (!isEditing) return;
    if (!originalFoodName && foodNameInputRef.current) {
      foodNameInputRef.current.focus();
      return;
    }
    const el = textareaRef.current;
    if (!el) return;
    el.focus();
    const len = el.value.length;
    el.setSelectionRange(len, len);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isEditing]);

  // 入力後debounceして下書きを保存する。変更対象項目のうち、元の値と同じものは送らない
  useEffect(() => {
    if (!isEditing || !entry.eventId) return;
    if (draftSaveTimerRef.current) window.clearTimeout(draftSaveTimerRef.current);
    draftSaveTimerRef.current = window.setTimeout(() => {
      const changes: FieldLogDraftChanges = {};
      if (draftFoodName !== originalFoodName) changes.foodName = draftFoodName;
      if (draftLocation !== originalLocation) changes.location = draftLocation;
      if (draftMemo !== originalMemo) changes.memo = draftMemo;

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
  }, [draftFoodName, draftLocation, draftMemo, isEditing, originalFoodName, originalLocation, originalMemo, entry.eventId]);

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

  const startEditing = () => {
    setDraftFoodName(originalFoodName);
    setDraftLocation(originalLocation);
    setDraftMemo(originalMemo);
    setSaveError('');
    setSaveNotice('');
    setShowUnsavedConfirm(false);
    draftSaveFailedShownRef.current = false;
    setDraftSaveFailedNotice(false);
    setIsEditing(true);
  };

  const restoreDraft = () => {
    if (!draftPrompt) return;
    const c = draftPrompt.changes;
    setDraftFoodName(typeof c.foodName === 'string' ? c.foodName : originalFoodName);
    setDraftLocation(typeof c.location === 'string' ? c.location : originalLocation);
    setDraftMemo(typeof c.memo === 'string' ? c.memo : originalMemo);
    setSaveError('');
    setSaveNotice('');
    setShowUnsavedConfirm(false);
    draftSaveFailedShownRef.current = false;
    setDraftSaveFailedNotice(false);
    setIsEditing(true);
    setDraftPrompt(null);
  };

  const discardDraftPrompt = () => {
    if (entry.eventId) clearFieldLogDraft(entry.eventId);
    setDraftPrompt(null);
  };

  const hasDiff = draftFoodName !== originalFoodName || draftLocation !== originalLocation || draftMemo !== originalMemo;

  const handleBack = () => {
    if (!isEditing) {
      go(from);
      return;
    }
    if (!hasDiff) {
      setIsEditing(false);
      return;
    }
    setShowUnsavedConfirm(true);
  };

  const discardAndStay = () => {
    if (entry.eventId) clearFieldLogDraft(entry.eventId);
    setDraftFoodName(originalFoodName);
    setDraftLocation(originalLocation);
    setDraftMemo(originalMemo);
    setSaveError('');
    setShowUnsavedConfirm(false);
    setIsEditing(false);
  };

  const continueEditing = () => {
    setShowUnsavedConfirm(false);
  };

  const handleSave = async () => {
    if (isSaving || !idToken || !entry.eventId || foodNameError) return;

    const changes: FieldUpdateEntryChanges = {};
    if (draftFoodName !== originalFoodName) changes.foodName = draftFoodName;
    if (draftLocation !== originalLocation) changes.location = draftLocation;
    if (draftMemo !== originalMemo) changes.memo = draftMemo;

    if (Object.keys(changes).length === 0) {
      setIsEditing(false);
      return;
    }

    setIsSaving(true);
    setSaveError('');

    // debounce待ちのズレを防ぐため、送信直前の内容を即座に下書きへ反映しておく（成功すれば直後に削除する）
    const draftOk = saveFieldLogDraft(entry.eventId, changes);
    if (!draftOk && !draftSaveFailedShownRef.current) {
      draftSaveFailedShownRef.current = true;
      setDraftSaveFailedNotice(true);
    }

    try {
      const result = await updateFieldLogEntry(entry.eventId, changes, idToken);
      if (typeof result.entry.memo === 'string') {
        setOriginalMemo(result.entry.memo);
        setDraftMemo(result.entry.memo);
      }
      if (typeof result.entry.foodName === 'string') {
        setOriginalFoodName(result.entry.foodName);
        setDraftFoodName(result.entry.foodName);
      }
      if (typeof result.entry.place === 'string') {
        setOriginalLocation(result.entry.place);
        setDraftLocation(result.entry.place);
      }
      setIsEditing(false);
      setShowUnsavedConfirm(false);
      clearFieldLogDraft(entry.eventId);
      useZukanFieldStore.getState().updateEntry(entry.eventId, result.entry);

      if (!result.noChange) {
        if (result.warning) {
          showNoticeThenClear('保存されました。外部データへの反映が一部完了していません。', 5000);
        } else {
          showNoticeThenClear('保存しました', 4000);
        }
      }
    } catch (e) {
      if (e instanceof TokenExpiredError) handleTokenExpired();
      setSaveError(e instanceof Error ? e.message : '保存に失敗しました。もう一度お試しください。');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className={styles.root}>
      <header className={styles.header}>
        <button className={styles.back} onClick={handleBack}>← 戻る</button>
        <span className={styles.title}>観察記録</span>
        {canEdit && !isEditing && !draftPrompt && (
          <button className={styles.editBtn} onClick={startEditing}>編集</button>
        )}
      </header>

      <main className={styles.main}>
        <div className={styles.photoWrap}>
          {entry.photoUrl
            ? <img className={styles.photo} src={entry.photoUrl} alt={entry.foodName} />
            : <div className={styles.photoPlaceholder}>写真なし</div>}
        </div>

        {isEditing ? (
          <div className={styles.foodNameEditWrap}>
            <span className={styles.editingTag}>編集中</span>
            <input
              ref={foodNameInputRef}
              className={styles.foodNameInput}
              value={draftFoodName}
              onChange={(e) => setDraftFoodName(e.target.value)}
              placeholder="食材名を入力"
              disabled={isSaving}
            />
            <span className={styles.requiredMark}>必須</span>
            {foodNameError && <p className={styles.errorText}>{foodNameError}</p>}
          </div>
        ) : (
          <h1 className={styles.foodName}>{originalFoodName || '無題'}</h1>
        )}

        <div className={styles.metaRow}>
          {isEditing ? (
            <input
              className={styles.locationInput}
              value={draftLocation}
              onChange={(e) => setDraftLocation(e.target.value)}
              placeholder="場所を入力（任意）"
              disabled={isSaving}
            />
          ) : (
            <span className={styles.metaItem}>📍 {originalLocation || '場所不明'}</span>
          )}
          <span className={styles.metaItem}>{entry.date}</span>
          {entry.kigo && <span className={styles.tag}>{entry.kigo}</span>}
        </div>

        {!isEditing && draftPrompt && (
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

        {(canEdit || originalMemo) && (
          <div className={styles.memoBox}>
            <p className={styles.memoLabel}>観察内容</p>

            {isEditing ? (
              <textarea
                ref={textareaRef}
                className={styles.memoTextarea}
                rows={6}
                value={draftMemo}
                onChange={(e) => setDraftMemo(e.target.value)}
                disabled={isSaving}
              />
            ) : (
              <p className={styles.memoText}>
                {originalMemo || (canEdit ? 'メモはまだありません' : '')}
              </p>
            )}

            {!isEditing && saveNotice && (
              <p className={styles.saveNotice}>{saveNotice}</p>
            )}
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
            {entry.notionUrl && (
              <a className={styles.linkBtn} href={entry.notionUrl} target="_blank" rel="noreferrer">
                📝 Notionで開く
              </a>
            )}
          </div>
        )}
      </main>

      {isEditing && (
        <footer className={styles.footer}>
          {showUnsavedConfirm ? (
            <div className={styles.confirmRow}>
              <p className={styles.confirmText}>保存されていない変更があります</p>
              <div className={styles.confirmBtns}>
                <button className={styles.continueBtn} onClick={continueEditing}>編集を続ける</button>
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
              {foodNameError && <p className={styles.errorText}>{foodNameError}</p>}
              {saveError && <p className={styles.errorText}>{saveError}</p>}
              <button className={styles.saveBtn} disabled={isSaving || !!foodNameError} onClick={() => void handleSave()}>
                {isSaving ? '保存中…' : '保存'}
              </button>
            </>
          )}
        </footer>
      )}
    </div>
  );
}
