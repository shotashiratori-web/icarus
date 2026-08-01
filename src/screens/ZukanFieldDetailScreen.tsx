import { useEffect, useRef, useState } from 'react';
import type { FieldLogEntry } from '../types/zukan';
import type { Screen } from '../App';
import { useAuth } from '../context/AuthContext';
import { useZukanFieldStore } from '../store/zukanFieldStore';
import { updateFieldLogEntryMemo } from '../api/zukanApi';
import { TokenExpiredError } from '../api/icarusApi';
import {
  loadFieldLogDraft,
  saveFieldLogDraft,
  clearFieldLogDraft,
  isOldDraft,
  formatDraftSavedAt,
  type FieldLogDraft,
} from '../utils/fieldLogDraft';
import styles from './ZukanFieldDetailScreen.module.css';

type Props = { go: (s: Screen) => void; entry: FieldLogEntry; from: Screen };

const DRAFT_SAVE_DEBOUNCE_MS = 800;

export default function ZukanFieldDetailScreen({ go, entry, from }: Props) {
  const { idToken, staffMe, handleTokenExpired } = useAuth();
  const canEdit = staffMe?.role === 'admin' && !!entry.eventId;

  const [originalMemo, setOriginalMemo] = useState(entry.memo);
  const [draftMemo, setDraftMemo] = useState(entry.memo);
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [saveNotice, setSaveNotice] = useState('');
  const [showUnsavedConfirm, setShowUnsavedConfirm] = useState(false);
  const [draftPrompt, setDraftPrompt] = useState<FieldLogDraft | null>(null);
  const [draftSaveFailedNotice, setDraftSaveFailedNotice] = useState(false);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const noticeTimerRef = useRef<number | null>(null);
  const draftSaveTimerRef = useRef<number | null>(null);
  const draftSaveFailedShownRef = useRef(false);

  // 画面表示時、同じentryIdの下書きが残っていないか確認する（自動上書きはしない）
  useEffect(() => {
    if (!entry.eventId) return;
    const draft = loadFieldLogDraft(entry.eventId);
    if (draft && typeof draft.changes.memo === 'string' && draft.changes.memo !== entry.memo) {
      setDraftPrompt(draft);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entry.eventId]);

  useEffect(() => {
    if (!isEditing) return;
    const el = textareaRef.current;
    if (!el) return;
    el.focus();
    const len = el.value.length;
    el.setSelectionRange(len, len);
  }, [isEditing]);

  // 入力後debounceして下書きを保存する。元の値と同じに戻ったら保存せず削除する
  useEffect(() => {
    if (!isEditing || !entry.eventId) return;
    if (draftSaveTimerRef.current) window.clearTimeout(draftSaveTimerRef.current);
    draftSaveTimerRef.current = window.setTimeout(() => {
      if (draftMemo === originalMemo) {
        clearFieldLogDraft(entry.eventId);
        return;
      }
      const ok = saveFieldLogDraft(entry.eventId, { memo: draftMemo });
      if (!ok && !draftSaveFailedShownRef.current) {
        draftSaveFailedShownRef.current = true;
        setDraftSaveFailedNotice(true);
      }
    }, DRAFT_SAVE_DEBOUNCE_MS);
    return () => {
      if (draftSaveTimerRef.current) window.clearTimeout(draftSaveTimerRef.current);
    };
  }, [draftMemo, isEditing, originalMemo, entry.eventId]);

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
    const memo = typeof draftPrompt.changes.memo === 'string' ? draftPrompt.changes.memo : originalMemo;
    setDraftMemo(memo);
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

  const hasDiff = draftMemo !== originalMemo;

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
    setDraftMemo(originalMemo);
    setSaveError('');
    setShowUnsavedConfirm(false);
    setIsEditing(false);
  };

  const continueEditing = () => {
    setShowUnsavedConfirm(false);
  };

  const handleSave = async () => {
    if (isSaving || !idToken || !entry.eventId) return;
    setIsSaving(true);
    setSaveError('');

    // debounce待ちのズレを防ぐため、送信直前の内容を即座に下書きへ反映しておく（成功すれば直後に削除する）
    if (draftMemo !== originalMemo) {
      const ok = saveFieldLogDraft(entry.eventId, { memo: draftMemo });
      if (!ok && !draftSaveFailedShownRef.current) {
        draftSaveFailedShownRef.current = true;
        setDraftSaveFailedNotice(true);
      }
    }

    try {
      const result = await updateFieldLogEntryMemo(entry.eventId, draftMemo, idToken);
      setOriginalMemo(result.memo);
      setDraftMemo(result.memo);
      setIsEditing(false);
      setShowUnsavedConfirm(false);
      clearFieldLogDraft(entry.eventId);
      useZukanFieldStore.getState().updateEntryMemo(entry.eventId, result.memo);

      if (!result.noChange) {
        if (result.warning) {
          showNoticeThenClear('メモは保存されました。\n外部データへの反映が一部完了していません。', 5000);
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

        <h1 className={styles.foodName}>{entry.foodName || '無題'}</h1>

        <div className={styles.metaRow}>
          <span className={styles.metaItem}>📍 {entry.place || '場所不明'}</span>
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
            <p className={styles.memoLabel}>
              観察内容
              {isEditing && <span className={styles.editingTag}>編集中</span>}
            </p>

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
              {saveError && <p className={styles.errorText}>{saveError}</p>}
              <button className={styles.saveBtn} disabled={isSaving} onClick={() => void handleSave()}>
                {isSaving ? '保存中…' : '保存'}
              </button>
            </>
          )}
        </footer>
      )}
    </div>
  );
}
