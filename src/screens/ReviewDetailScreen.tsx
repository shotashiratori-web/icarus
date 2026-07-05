import { useEffect, useState } from 'react';
import { getNote } from '../db/localDB';
import type { WineNote } from '../types/wine';
import type { Screen } from '../App';
import styles from './ReviewDetailScreen.module.css';

type Props = { noteId: string; go: (s: Screen) => void };

export default function ReviewDetailScreen({ noteId, go }: Props) {
  const [note, setNote] = useState<WineNote | null>(null);

  useEffect(() => {
    getNote(noteId).then(n => n && setNote(n));
  }, [noteId]);

  if (!note) return <div className={styles.loading}>読み込み中…</div>;

  const f = note.fields;
  const syncLabel =
    note.sync_status === 'synced'  ? '✓ 同期済み' :
    note.sync_status === 'syncing' ? '↑ 同期中…'  :
    note.sync_status === 'failed'  ? '✗ 同期失敗'  :
    '● ローカル保存';

  return (
    <div className={styles.root}>
      {/* Toolbar */}
      <header className={styles.toolbar}>
        <button className={styles.back} onClick={() => go({ name: 'home' })}>
          ← Home
        </button>
        <span className={styles.sync}>{syncLabel}</span>
        <button
          className={styles.editBtn}
          onClick={() => go({ name: 'record', noteId: note.id })}
        >
          編集
        </button>
      </header>

      {/* コンテンツ */}
      <main className={styles.main}>
        <div className={styles.card}>

          {/* ワイン名・基本情報 */}
          <h1 className={styles.wineName}>
            {f.wine_name.text || '名称未設定'}
          </h1>

          <div className={styles.meta}>
            {f.producer.text     && <span>{f.producer.text}</span>}
            {f.vintage.text      && <span>{f.vintage.text}</span>}
            {f.tasting_date.text && <span>{f.tasting_date.text}</span>}
          </div>

          {/* MEMO */}
          {f.memo.text && (
            <section className={styles.section}>
              <h2 className={styles.sectionLabel}>MEMO</h2>
              <p className={styles.body}>{f.memo.text}</p>
            </section>
          )}

          {/* 空のとき */}
          {!f.memo.text && (
            <p className={styles.empty}>メモはまだありません</p>
          )}
        </div>
      </main>
    </div>
  );
}
