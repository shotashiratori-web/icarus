import { useEffect, useState } from 'react';
import { getAllNotes } from '../db/localDB';
import { createWine } from '../api/wineEntityApi';
import { useAuth } from '../context/AuthContext';
import type { WineNote } from '../types/wine';
import type { Screen } from '../App';
import styles from './NoteListScreen.module.css';

type Props = { go: (s: Screen) => void };
type ImportState = 'idle' | 'running' | 'done';

export default function NoteListScreen({ go }: Props) {
  const { idToken } = useAuth();
  const [notes, setNotes] = useState<WineNote[]>([]);
  const [importState, setImportState] = useState<ImportState>('idle');
  const [importResult, setImportResult] = useState<{ created: number; skipped: number; failed: number } | null>(null);

  useEffect(() => { getAllNotes().then(setNotes); }, []);

  // Phase8/9: 既存のワインノート（個人の試飲記録、IndexedDB）をベースに、
  // Wine Entity（共有D1）を新規作成する一回限りの取り込み作業。元のノートは一切変更しない。
  const handleImport = async () => {
    if (!idToken || importState === 'running') return;
    if (!confirm(`${notes.length}件のノートを確認し、ワイン名があるものをワイン図鑑へ登録します。よろしいですか？`)) return;

    setImportState('running');
    let created = 0, skipped = 0, failed = 0;
    for (const note of notes) {
      const title = note.fields.wine_name.text.trim();
      if (!title) { skipped++; continue; }

      const producer = note.fields.producer.text.trim();
      const vintageText = note.fields.vintage.text.trim();
      const vintage = vintageText && /^\d+$/.test(vintageText) ? Number(vintageText) : null;
      const memo = note.fields.memo.text.trim();
      const tastingDate = note.fields.tasting_date.text.trim();
      const description = tastingDate ? `試飲日: ${tastingDate}${memo ? '\n' + memo : ''}` : memo;

      try {
        await createWine({ title, producer, vintage, variety: '', origin: '', description, photos: [], tags: [] }, idToken);
        created++;
      } catch {
        failed++;
      }
    }
    setImportResult({ created, skipped, failed });
    setImportState('done');
  };

  return (
    <div className={styles.root}>
      <header className={styles.header}>
        <button className={styles.back} onClick={() => go({ name: 'home' })}>← Home</button>
        <span className={styles.title}>すべてのノート</span>
        <span className={styles.count}>{notes.length}件</span>
      </header>

      {idToken && notes.length > 0 && (
        <div className={styles.importBar}>
          <button className={styles.importBtn} disabled={importState === 'running'} onClick={() => void handleImport()}>
            {importState === 'running' ? '登録中…' : '🍷 ワイン図鑑へまとめて登録'}
          </button>
          {importResult && (
            <span className={styles.importResult}>
              作成{importResult.created}件・スキップ{importResult.skipped}件・失敗{importResult.failed}件
            </span>
          )}
        </div>
      )}

      <main className={styles.list}>
        {notes.map(n => (
          <button
            key={n.id}
            className={styles.item}
            onClick={() => go({ name: 'review', noteId: n.id })}
          >
            {n.label_photo_url
              ? <img src={n.label_photo_url} alt="" className={styles.photo} />
              : <div className={styles.photoPlaceholder}>🍷</div>
            }
            <div className={styles.info}>
              <p className={styles.name}>{n.fields.wine_name.text || '名称未設定'}</p>
              <p className={styles.sub}>
                {[n.fields.producer.text, n.fields.vintage.text].filter(Boolean).join(' · ')}
              </p>
              <p className={styles.date}>{n.fields.tasting_date.text}</p>
            </div>
            <span className={styles.arrow}>→</span>
          </button>
        ))}
        {notes.length === 0 && (
          <p className={styles.empty}>ノートはまだありません</p>
        )}
      </main>
    </div>
  );
}
