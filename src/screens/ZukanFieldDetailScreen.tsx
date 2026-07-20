import type { FieldLogEntry } from '../types/zukan';
import type { Screen } from '../App';
import styles from './ZukanFieldDetailScreen.module.css';

type Props = { go: (s: Screen) => void; entry: FieldLogEntry; from: Screen };

export default function ZukanFieldDetailScreen({ go, entry, from }: Props) {
  return (
    <div className={styles.root}>
      <header className={styles.header}>
        <button className={styles.back} onClick={() => go(from)}>← 戻る</button>
        <span className={styles.title}>観察記録</span>
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

        {entry.memo && (
          <div className={styles.memoBox}>
            <p className={styles.memoLabel}>観察内容</p>
            <p className={styles.memoText}>{entry.memo}</p>
          </div>
        )}

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
      </main>
    </div>
  );
}
