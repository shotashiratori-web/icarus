import { useEffect, useState } from 'react';
import { getAllNotes, loadFoodLogDraft } from '../db/localDB';
import { fetchRecentFieldObservations, fetchRecentWorkLogs } from '../api/fieldApi';
import { requestSilentIdToken } from '../api/googleAuth';
import type { FieldObservation, WorkLogItem } from '../types/fieldLog';
import type { WineNote } from '../types/wine';
import type { Screen } from '../App';
import styles from './HomeScreen.module.css';

type Props = { go: (s: Screen) => void };

interface FoodDraftSummary {
  photoCount: number;
  savedAt: string;
  hasRetry: boolean;
}

export default function HomeScreen({ go }: Props) {
  const [recent, setRecent] = useState<WineNote[]>([]);
  const [foodDraft, setFoodDraft] = useState<FoodDraftSummary | null>(null);
  const [recentObservations, setRecentObservations] = useState<FieldObservation[]>([]);
  const [recentProcessing, setRecentProcessing] = useState<WorkLogItem[]>([]);

  useEffect(() => {
    getAllNotes().then(all => setRecent(all.slice(0, 5)));
    loadFoodLogDraft().then(draft => {
      if (!draft || draft.photos.length === 0) return;
      const hasRetry = (draft.sendResults ?? []).some(
        r => r.status === 'failed' || r.status === 'unknown',
      );
      setFoodDraft({ photoCount: draft.photos.length, savedAt: draft.savedAt, hasRetry });
    });
  }, []);

  // 最近の観察・最近の作業（失敗してもホーム画面全体には影響させない）
  useEffect(() => {
    let cancelled = false;
    requestSilentIdToken().then(token => {
      if (cancelled || !token) return;
      fetchRecentFieldObservations(token, 3)
        .then(items => { if (!cancelled) setRecentObservations(items); })
        .catch(() => {});
      fetchRecentWorkLogs(token, 3)
        .then(items => { if (!cancelled) setRecentProcessing(items); })
        .catch(() => {});
    });
    return () => { cancelled = true; };
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

        <button
          className={styles.cta}
          onClick={() => go({ name: 'foodLog' })}
        >
          <span className={styles.ctaIcon}>🌿</span>
          <span className={styles.ctaLabel}>食材ログを送る</span>
          <span className={styles.ctaArrow}>→ 記録</span>
        </button>

        <div className={styles.navRow}>
          <button className={styles.navBtn} onClick={() => go({ name: 'field' })}>
            <span className={styles.navIcon}>📍</span>
            <span>フィールド</span>
          </button>
          <button className={styles.navBtn} onClick={() => go({ name: 'processing' })}>
            <span className={styles.navIcon}>🧂</span>
            <span>加工</span>
          </button>
        </div>

        {(recentObservations.length > 0 || recentProcessing.length > 0) && (
          <section className={styles.section}>
            {recentObservations.length > 0 && (
              <div className={styles.miniGroup}>
                <div className={styles.sectionHeader}>
                  <h2 className={styles.sectionTitle}>最近の観察</h2>
                  <button className={styles.viewAll} onClick={() => go({ name: 'field' })}>もっと見る</button>
                </div>
                <ul className={styles.miniList}>
                  {recentObservations.map(item => (
                    <li key={item.eventId} className={styles.miniItem}>
                      <span className={styles.miniName}>{item.food}</span>
                      <span className={styles.miniDate}>{item.date.slice(5)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {recentProcessing.length > 0 && (
              <div className={styles.miniGroup}>
                <div className={styles.sectionHeader}>
                  <h2 className={styles.sectionTitle}>最近の作業</h2>
                  <button className={styles.viewAll} onClick={() => go({ name: 'processing' })}>もっと見る</button>
                </div>
                <ul className={styles.miniList}>
                  {recentProcessing.map(item => (
                    <li key={item.workId} className={styles.miniItem}>
                      <span className={styles.miniName}>{item.processingName}</span>
                      <span className={styles.miniDate}>{item.datetime.slice(5, 10)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>
        )}

        {foodDraft && (
          <button className={styles.draftCard} onClick={() => go({ name: 'draftList' })}>
            <div className={styles.draftInfo}>
              <span className={styles.draftIcon}>{foodDraft.hasRetry ? '⚠️' : '📝'}</span>
              <div>
                <p className={styles.draftName}>
                  {foodDraft.hasRetry ? '未送信あり' : '食材ログ下書き'}（{foodDraft.photoCount} 枚）
                </p>
                <p className={styles.draftPreview}>{foodDraft.savedAt.slice(0, 16).replace('T', ' ')}</p>
              </div>
            </div>
            <span className={styles.draftCta}>確認 →</span>
          </button>
        )}

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
