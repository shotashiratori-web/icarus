import { useEffect, useCallback, useRef, useState } from 'react';
import { useNoteStore } from '../store/noteStore';
import { getNote } from '../db/localDB';
import { newWineNote } from '../types/wine';
import type { Screen } from '../App';
import styles from './RecordScreen.module.css';

type Props = { noteId: string | null; go: (s: Screen) => void };

export default function RecordScreen({ noteId, go }: Props) {
  const { note, setNote, updateField, persist, clear } = useNoteStore();
  const saving = useRef(false);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'done' | 'error'>('idle');

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

  // 保存してHomeへ
  const handleSave = useCallback(async () => {
    if (saving.current || !note) return;
    saving.current = true;
    setSaveState('saving');
    try {
      await persist();
      setSaveState('done');
      setTimeout(() => go({ name: 'home' }), 600);
    } catch (e) {
      setSaveState('error');
      saving.current = false;
    }
  }, [note, persist, go]);

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
    }
    go({ name: 'home' });
  }, [note, persist, go]);

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
    </div>
  );
}
