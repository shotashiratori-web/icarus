import type { WineEntity } from '../types/wineEntity';
import type { Screen } from '../App';
import styles from './WineDetailScreen.module.css';

type Props = { go: (s: Screen) => void; entry: WineEntity };

export default function WineDetailScreen({ go, entry }: Props) {
  return (
    <div className={styles.root}>
      <header className={styles.header}>
        <button className={styles.back} onClick={() => go({ name: 'wineList' })}>← 一覧へ戻る</button>
        <span className={styles.title}>ワイン</span>
      </header>

      <main className={styles.main}>
        <div className={styles.photoWrap}>
          {entry.photos[0]
            ? <img className={styles.photo} src={entry.photos[0]} alt={entry.title} />
            : <div className={styles.photoPlaceholder}>🍷</div>}
        </div>

        <h1 className={styles.wineTitle}>{entry.title || '無題'}</h1>

        <div className={styles.metaRow}>
          {entry.producer && <span className={styles.metaItem}>🏭 {entry.producer}</span>}
          {entry.vintage && <span className={styles.metaItem}>{entry.vintage}</span>}
          {entry.origin && <span className={styles.metaItem}>📍 {entry.origin}</span>}
        </div>

        {entry.variety && <span className={styles.tag}>{entry.variety}</span>}

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

        {/* Phase10以降: ここに関連フィールド・関連料理・関連加工・関連Daily・関連Wine Tasting NoteなどのKnowledge Relationセクションを追加する想定。
            今回は空のハブとして、画面構造のみ用意し、表示はしない。 */}

        <div className={styles.linkRow}>
          <button className={styles.editBtn} onClick={() => go({ name: 'wineForm', mode: 'edit', wine: entry })}>
            ✏️ 編集する
          </button>
        </div>
      </main>
    </div>
  );
}
