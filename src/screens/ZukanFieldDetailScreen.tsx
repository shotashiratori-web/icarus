import { useEffect, useRef, useState } from 'react';
import type { FieldLogEntry } from '../types/zukan';
import type { Screen } from '../App';
import { useAuth } from '../context/AuthContext';
import { useZukanFieldStore } from '../store/zukanFieldStore';
import { updateFieldLogEntryMemo } from '../api/zukanApi';
import { TokenExpiredError } from '../api/icarusApi';
import styles from './ZukanFieldDetailScreen.module.css';

type Props = { go: (s: Screen) => void; entry: FieldLogEntry; from: Screen };

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

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const noticeTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (!isEditing) return;
    const el = textareaRef.current;
    if (!el) return;
    el.focus();
    const len = el.value.length;
    el.setSelectionRange(len, len);
  }, [isEditing]);

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
    setIsEditing(true);
  };

  const hasDiff = draftMemo !== originalMemo;

  const handleBack = () => {
    if (!isEditing || !hasDiff) {
      go(from);
      return;
    }
    setShowUnsavedConfirm(true);
  };

  const discardAndLeave = () => {
    go(from);
  };

  const continueEditing = () => {
    setShowUnsavedConfirm(false);
  };

  const handleSave = async () => {
    if (isSaving || !idToken || !entry.eventId) return;
    setIsSaving(true);
    setSaveError('');
    try {
      const result = await updateFieldLogEntryMemo(entry.eventId, draftMemo, idToken);
      setOriginalMemo(result.memo);
      setDraftMemo(result.memo);
      setIsEditing(false);
      setShowUnsavedConfirm(false);
      useZukanFieldStore.getState().updateEntryMemo(entry.eventId, result.memo);

      if (!result.noChange) {
        if (result.warning) {
          showNoticeThenClear('メモは保存されました。\n外部データへの反映が一部完了していません。', 4500);
        } else {
          showNoticeThenClear('保存しました', 1500);
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
        {canEdit && !isEditing && (
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
                <button className={styles.discardBtn} onClick={discardAndLeave}>変更を破棄して戻る</button>
              </div>
            </div>
          ) : (
            <>
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
