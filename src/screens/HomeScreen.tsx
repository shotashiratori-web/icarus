import { useEffect, useState } from 'react';
import { getAllNotes } from '../db/localDB';
import type { WineNote } from '../types/wine';
import type { Screen } from '../App';
import styles from './HomeScreen.module.css';

type Props = { go: (s: Screen) => void };

export default function HomeScreen({ go }: Props) {
  const [recent, setRecent] = useState<WineNote[]>([]);

  useEffect(() => {
    getAllNotes().then(all => setRecent(all.slice(0, 5)));
  }, []);

  return (
    <div className={styles.root}>
      <header className={styles.header}>
        <span className={styles.logo}>Icarus</span>
        <button className={styles.settingsBtn}>設定</button>
      </header>

      <main className={styles.main}>
        {/* Primary CTA */}
        <button
          className={styles.cta}
          onClick={() => go({ name: 'record', noteId: null })}
        >
          <span className={styles.ctaIcon}>✏️</span>
          <span className={styles.ctaLabel}>新しいワインノート</span>
          <span className={styles.ctaArrow}>→ 作る</span>
        </button>

        {/* 最近のノート */}
        {recent.length > 0 && (
          <section className={styles.section}>
            <div className={styles.sectionHeader}>
              <h2 className={styles.sectionTitle}>最近のノート</h2>
              <button
                className={styles.viewAll}
                onClick={() => go({ name: 'list' })}
              >
                全部見る
              </button>
            </div>
            <div className={styles.thumbnails}>
              {recent.map(n => (
                <button
                  key={n.id}
                  className={styles.thumb}
                  onClick={() => go({ name: 'review', noteId: n.id })}
                >
                  {n.label_photo_url ? (
                    <img src={n.label_photo_url} alt="" className={styles.thumbImg} />
                  ) : (
                    <div className={styles.thumbPlaceholder}>🍷</div>
                  )}
                  <p className={styles.thumbName}>
                    {(n.fields.wine_name.text || '名称未設定').slice(0, 10)}
                  </p>
                  <p className={styles.thumbDate}>
                    {n.fields.tasting_date.text.slice(5)}
                  </p>
                </button>
              ))}
            </div>
          </section>
        )}

        {/* 初回: ノートがない場合 */}
        {recent.length === 0 && (
          <p className={styles.empty}>
            最初のワインノートを作りましょう。
          </p>
        )}
      </main>
    </div>
  );
}
