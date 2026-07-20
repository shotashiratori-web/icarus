import type { FieldLogEntry } from '../types/zukan';
import type { Screen } from '../App';
import styles from './ZukanFieldDetailScreen.module.css';

type Props = { go: (s: Screen) => void; entry: FieldLogEntry };

export default function ZukanFieldDetailScreen({ go, entry }: Props) {
  return (
    <div className={styles.root}>
      <header className={styles.header}>
        <button className={styles.back} onClick={() => go({ name: 'zukanFieldList' })}>← フィールド</button>
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
          <button className={`${styles.linkBtn} ${styles.linkBtnDisabled}`} disabled>
            📍 地図で見る
            <span className={styles.linkBadge}>準備中</span>
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
