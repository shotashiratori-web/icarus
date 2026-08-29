import { useEffect, useCallback, useRef, useState } from 'react';
import { useNoteStore } from '../store/noteStore';
import { getNote } from '../db/localDB';
import { newWineNote } from '../types/wine';
import { resizeToJpeg, TokenExpiredError } from '../api/icarusApi';
import { fetchWine } from '../api/wineEntityApi';
import { useAuth } from '../context/AuthContext';
import { syncWineTastingNote } from '../submission/wineTastingNoteSync';
import WineLinkPicker from './WineLinkPicker';
import type { WineEntity } from '../types/wineEntity';
import type { Screen } from '../App';
import styles from './RecordScreen.module.css';

type Props = { noteId: string | null; go: (s: Screen) => void };

export default function RecordScreen({ noteId, go }: Props) {
  const { note, setNote, updateField, setPhoto, setWineId, persist, clear } = useNoteStore();
  const { idToken, handleTokenExpired } = useAuth();
  const saving = useRef(false);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'done' | 'error'>('idle');
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoError, setPhotoError] = useState('');
  const [linkedWine, setLinkedWine] = useState<WineEntity | null>(null);
  const [showWinePicker, setShowWinePicker] = useState(false);

  const handlePhotoChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // 同じファイルを連続選択できるようにリセット
    if (!file) return;
    setPhotoBusy(true);
    setPhotoError('');
    try {
      const base64 = await resizeToJpeg(file);
      setPhoto(`data:image/jpeg;base64,${base64}`);
    } catch {
      setPhotoError('写真の読み込みに失敗しました');
    } finally {
      setPhotoBusy(false);
    }
  };

  // ノートを読み込む or 新規作成
  useEffect(() => {
    if (noteId) {
      getNote(noteId).then(n => {
        if (n) setNote(n);
        else setNote(newWineNote()); // IDが見つからなければ新規
      });
    } else {
      setNote(newWineNote());
    }
    return () => clear();
  }, [noteId]);

  // Stage 1C-A: note.wine_idが設定されていれば、表示用にWine Entity本体を取得する
  // （wine_idはUUIDのみ保持しているため、title/producer/vintage表示にはfetchが必要）
  useEffect(() => {
    if (!note?.wine_id || !idToken) { setLinkedWine(null); return; }
    let cancelled = false;
    fetchWine(note.wine_id, idToken)
      .then((w) => { if (!cancelled) setLinkedWine(w); })
      .catch((e) => {
        if (cancelled) return;
        if (e instanceof TokenExpiredError) { handleTokenExpired(); return; }
        setLinkedWine(null);
      });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [note?.wine_id, idToken]);

  const handleSelectWine = (wine: WineEntity) => {
    setWineId(wine.id);
    setLinkedWine(wine);
    setShowWinePicker(false);
  };

  const handleUnlinkWine = () => {
    setWineId(null);
    setLinkedWine(null);
  };

  // 保存してHomeへ
  const handleSave = useCallback(async () => {
    if (saving.current || !note) return;
    saving.current = true;
    setSaveState('saving');
    try {
      await persist();
      void syncWineTastingNote(note.id, idToken);
      setSaveState('done');
      setTimeout(() => go({ name: 'home' }), 600);
    } catch (e) {
      setSaveState('error');
      saving.current = false;
    }
  }, [note, persist, go, idToken]);

  // ⌘+S
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        handleSave();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [handleSave]);

  // Homeへ戻る（内容があれば自動保存）
  const handleBack = useCallback(async () => {
    if (note && useNoteStore.getState().isDirty) {
      await persist();
      void syncWineTastingNote(note.id, idToken);
    }
    go({ name: 'home' });
  }, [note, persist, go, idToken]);

  if (!note) return <div className={styles.loading}>読み込み中…</div>;

  const f = note.fields;

  return (
    <div className={styles.root}>
      {/* Toolbar */}
      <header className={styles.toolbar}>
        <button className={styles.back} onClick={handleBack}>
          ← Home
        </button>
        <span className={styles.title}>
          {f.wine_name.text || '新しいワインノート'}
        </span>
        <button
          className={`${styles.saveBtn} ${saveState === 'done' ? styles.saveDone : ''} ${saveState === 'error' ? styles.saveError : ''}`}
          onClick={handleSave}
          disabled={saveState === 'saving' || saveState === 'done'}
        >
          {saveState === 'saving' ? '保存中…' : saveState === 'done' ? '✓ 保存' : saveState === 'error' ? '失敗 再試行' : '保存'}
        </button>
      </header>

      {/* フォーム */}
      <main className={styles.main}>
        <div className={styles.form}>

          {/* PHOTO */}
          <div className={styles.field}>
            <label className={styles.label}>PHOTO</label>
            <button
              type="button"
              className={styles.photoBtn}
              onClick={() => fileInputRef.current?.click()}
              disabled={photoBusy}
            >
              {note.label_photo_url
                ? <img className={styles.photoPreview} src={note.label_photo_url} alt="" />
                : <span className={styles.photoPlaceholder}>{photoBusy ? '読み込み中…' : '📷 写真を追加'}</span>}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              className={styles.fileInput}
              onChange={handlePhotoChange}
            />
            {note.label_photo_url && (
              <button type="button" className={styles.photoRemoveBtn} onClick={() => setPhoto(null)}>
                写真を削除
              </button>
            )}
            {photoError && <p className={styles.photoError}>{photoError}</p>}
          </div>

          {/* NAME */}
          <div className={styles.field}>
            <label className={styles.label} htmlFor="wine_name">NAME</label>
            <input
              id="wine_name"
              className={styles.input}
              type="text"
              value={f.wine_name.text}
              onChange={e => updateField('wine_name', { text: e.target.value })}
              placeholder="ワイン名"
              autoComplete="off"
            />
          </div>

          {/* MADE BY */}
          <div className={styles.field}>
            <label className={styles.label} htmlFor="producer">MADE BY</label>
            <input
              id="producer"
              className={styles.input}
              type="text"
              value={f.producer.text}
              onChange={e => updateField('producer', { text: e.target.value })}
              placeholder="生産者"
              autoComplete="off"
            />
          </div>

          {/* VINTAGE */}
          <div className={styles.fieldInline}>
            <div className={styles.field} style={{ flex: 1 }}>
              <label className={styles.label} htmlFor="vintage">VINTAGE</label>
              <input
                id="vintage"
                className={styles.input}
                type="text"
                inputMode="numeric"
                value={f.vintage.text}
                onChange={e => updateField('vintage', { text: e.target.value })}
                placeholder="年"
                autoComplete="off"
              />
            </div>
            <div className={styles.field} style={{ flex: 1 }}>
              <label className={styles.label} htmlFor="tasting_date">DATE</label>
              <input
                id="tasting_date"
                className={styles.input}
                type="text"
                value={f.tasting_date.text}
                onChange={e => updateField('tasting_date', { text: e.target.value })}
                autoComplete="off"
              />
            </div>
          </div>

          {/* WINE LINK（Stage 1C-A）: 未接続でもNote保存は可能。自動紐付け・自動新規作成はしない */}
          <div className={styles.field}>
            <label className={styles.label}>ワイン図鑑</label>
            {note.wine_id ? (
              <div className={styles.wineLinkConnected}>
                <div className={styles.wineLinkInfo}>
                  <p className={styles.wineLinkTitle}>{linkedWine?.title ?? '読み込み中…'}</p>
                  {linkedWine && (
                    <p className={styles.wineLinkMeta}>
                      {[linkedWine.producer, linkedWine.vintage ? String(linkedWine.vintage) : ''].filter(Boolean).join(' · ')}
                    </p>
                  )}
                </div>
                <div className={styles.wineLinkActions}>
                  <button type="button" className={styles.wineLinkBtn} onClick={() => setShowWinePicker(true)} disabled={!idToken}>
                    変更
                  </button>
                  <button type="button" className={styles.wineLinkBtnDanger} onClick={handleUnlinkWine}>
                    紐付けを解除
                  </button>
                </div>
              </div>
            ) : (
              <button type="button" className={styles.wineLinkBtn} onClick={() => setShowWinePicker(true)} disabled={!idToken}>
                🍷 ワイン図鑑と紐付ける
              </button>
            )}
          </div>

          {/* MEMO */}
          <div className={styles.field}>
            <label className={styles.label} htmlFor="memo">MEMO</label>
            <textarea
              id="memo"
              className={styles.textarea}
              value={f.memo.text}
              onChange={e => updateField('memo', { text: e.target.value })}
              placeholder="テイスティングメモ"
              rows={8}
            />
          </div>

        </div>
      </main>

      {showWinePicker && idToken && (
        <WineLinkPicker
          initialQuery={f.wine_name.text}
          producerHint={f.producer.text}
          vintageHint={f.vintage.text}
          idToken={idToken}
          onSelect={handleSelectWine}
          onClose={() => setShowWinePicker(false)}
          onTokenExpired={handleTokenExpired}
        />
      )}
    </div>
  );
}
