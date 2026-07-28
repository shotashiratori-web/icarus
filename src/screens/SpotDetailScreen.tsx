import type { SpotEntity } from '../types/spotEntity';
import type { Screen } from '../App';
import styles from './SpotDetailScreen.module.css';

type Props = { go: (s: Screen) => void; entry: SpotEntity };

export default function SpotDetailScreen({ go, entry }: Props) {
  return (
    <div className={styles.root}>
      <header className={styles.header}>
        <button className={styles.back} onClick={() => go({ name: 'spotList' })}>← 一覧へ戻る</button>
        <span className={styles.title}>スポット</span>
      </header>

      <main className={styles.main}>
        <div className={styles.photoWrap}>
          {entry.photos[0]
            ? <img className={styles.photo} src={entry.photos[0]} alt={entry.title} />
            : <div className={styles.photoPlaceholder}>📍</div>}
        </div>

        <h1 className={styles.entryTitle}>{entry.title || '無題'}</h1>

        {(entry.lat != null && entry.lng != null) && (
          <div className={styles.metaRow}>
            <span className={styles.metaItem}>🌐 {entry.lat.toFixed(5)}, {entry.lng.toFixed(5)}</span>
          </div>
        )}

        {entry.category && <span className={styles.tag}>{entry.category}</span>}

        {entry.description && (
          <div className={styles.memoBox}>
            <p className={styles.memoLabel}>メモ</p>
            <p className={styles.memoText}>{entry.description}</p>
          </div>
        )}

        {entry.photos.length > 1 && (
          <div className={styles.sourceBox}>
            <p className={styles.sourceLabel}>元データ（そのままの記録）</p>
            <div className={styles.sourceImages}>
              {entry.photos.slice(1).map((url) => (
                <img key={url} className={styles.sourceImage} src={url} alt="元データ" />
              ))}
            </div>
          </div>
        )}

        <div className={styles.linkRow}>
          <button className={styles.editBtn} onClick={() => go({ name: 'spotForm', mode: 'edit', spot: entry })}>
            ✏️ 編集する
          </button>
        </div>
      </main>
    </div>
  );
}
