import { useEffect, useState } from 'react';
import { getAllNotes } from '../db/localDB';
import type { WineNote } from '../types/wine';
import type { Screen } from '../App';
import styles from './NoteListScreen.module.css';

type Props = { go: (s: Screen) => void };

export default function NoteListScreen({ go }: Props) {
  const [notes, setNotes] = useState<WineNote[]>([]);

  useEffect(() => { getAllNotes().then(setNotes); }, []);

  return (
    <div className={styles.root}>
      <header className={styles.header}>
        <button className={styles.back} onClick={() => go({ name: 'home' })}>← Home</button>
        <span className={styles.title}>すべてのノート</span>
        <span className={styles.count}>{notes.length}件</span>
      </header>
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
