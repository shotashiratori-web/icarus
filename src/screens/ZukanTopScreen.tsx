import type { Screen } from '../App';
import styles from './ZukanTopScreen.module.css';

type Props = { go: (s: Screen) => void };

interface MenuItem {
  icon: string;
  label: string;
  ready: boolean;
  onOpen?: () => void;
}

export default function ZukanTopScreen({ go }: Props) {
  const items: MenuItem[] = [
    { icon: '🌱', label: 'フィールド', ready: true, onOpen: () => go({ name: 'zukanFieldMap', from: { name: 'zukan' } }) },
    { icon: '🍷', label: 'ワイン', ready: true, onOpen: () => go({ name: 'wineList' }) },
    { icon: '🍅', label: '食材', ready: false },
    { icon: '🧂', label: '加工', ready: false },
    { icon: '🍽', label: '料理', ready: false },
  ];

  return (
    <div className={styles.root}>
      <header className={styles.header}>
        <button className={styles.back} onClick={() => go({ name: 'home' })}>← ホーム</button>
        <span className={styles.title}>📚 図鑑（試作版）</span>
      </header>

      <main className={styles.main}>
        <p className={styles.description}>
          この図鑑はLift Up余市が日々育てている知識の試作版です。内容は研究とともに更新されます。
        </p>

        <div className={styles.grid}>
          {items.map((item) => (
            <button
              key={item.label}
              className={`${styles.card} ${!item.ready ? styles.cardDisabled : ''}`}
              disabled={!item.ready}
              onClick={item.onOpen}
            >
              <span className={styles.cardIcon}>{item.icon}</span>
              <span className={styles.cardLabel}>{item.label}</span>
              {!item.ready && <span className={styles.cardBadge}>準備中</span>}
            </button>
          ))}
        </div>
      </main>
    </div>
  );
}
