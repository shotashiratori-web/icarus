import { useEffect, useState } from 'react';
import { getAllNotes } from '../db/localDB';
import { fetchRecentFieldObservations, fetchRecentWorkLogs } from '../api/fieldApi';
import { useAuth } from '../context/AuthContext';
import { useSubmissionQueue, selectCountsByEntity } from '../submission/queueStore';
import { ENTITY_LABELS, type SubmissionEntity } from '../submission/types';
import type { FieldObservation, WorkLogItem } from '../types/fieldLog';
import type { WineNote } from '../types/wine';
import type { Screen } from '../App';
import styles from './HomeScreen.module.css';

type Props = { go: (s: Screen) => void };

export default function HomeScreen({ go }: Props) {
  const { authState, staffMe, signInContainerRef, idToken } = useAuth();
  const [recent, setRecent] = useState<WineNote[]>([]);
  const [recentObservations, setRecentObservations] = useState<FieldObservation[]>([]);
  const [recentProcessing, setRecentProcessing] = useState<WorkLogItem[]>([]);
  const pendingItems = useSubmissionQueue((s) => s.items);
  const pendingCounts = selectCountsByEntity(pendingItems);

  useEffect(() => {
    getAllNotes().then(all => setRecent(all.slice(0, 5)));
    void useSubmissionQueue.getState().refresh();
  }, []);

  // 最近の観察・最近の作業（失敗してもホーム画面全体には影響させない）
  // 認証は他画面と同様、useAuth()のセッショントークンをそのまま使う
  // （Google IDトークンの再取得はしない。/field/recentはセッショントークンで認可される）
  useEffect(() => {
    if (authState !== 'ready' || !idToken) return;
    let cancelled = false;
    fetchRecentFieldObservations(idToken, 3)
      .then(items => { if (!cancelled) setRecentObservations(items); })
      .catch(() => {});
    fetchRecentWorkLogs(idToken, 3)
      .then(items => { if (!cancelled) setRecentProcessing(items); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [authState, idToken]);

  return (
    <div className={styles.root}>
      <header className={styles.header}>
        <span className={styles.logo}>Icarus</span>
        {staffMe && (
          <button className={styles.settingsBtn} onClick={() => go({ name: 'settings' })}>設定</button>
        )}
      </header>

      <main className={styles.main}>
        {authState === 'signedOut' && (
          <div className={styles.signInBox}>
            <p className={styles.signInText}>ログインが切れています。再度ログインしてください。</p>
            <div ref={signInContainerRef} />
          </div>
        )}

        {/* ── 記録する（Home IA整理 v1、2026-09-14） ── */}
        <section className={styles.section}>
          <div className={styles.sectionHeader}>
            <h2 className={styles.sectionTitle}>記録する</h2>
          </div>
          <button
            className={styles.cta}
            onClick={() => go({ name: 'foodLog' })}
          >
            <span className={styles.ctaIcon}>🌿</span>
            <span className={styles.ctaLabel}>フィールドを記録</span>
            <span className={styles.ctaArrow}>→ 記録</span>
          </button>
          <button
            className={styles.cta}
            onClick={() => go({ name: 'workForm', mode: 'create' })}
          >
            <span className={styles.ctaIcon}>🧂</span>
            <span className={styles.ctaLabel}>加工・作業を記録</span>
            <span className={styles.ctaArrow}>→ 記録</span>
          </button>
          <button
            className={styles.cta}
            onClick={() => go({ name: 'record', noteId: null })}
          >
            <span className={styles.ctaIcon}>🍷</span>
            <span className={styles.ctaLabel}>ワインを記録</span>
            <span className={styles.ctaArrow}>→ 記録</span>
          </button>
        </section>

        {pendingItems.length > 0 && (
          <section className={styles.section}>
            <div className={styles.sectionHeader}>
              <h2 className={styles.sectionTitle}>📤 保留中</h2>
            </div>
            <button className={styles.pendingSummaryBtn} onClick={() => go({ name: 'pendingList' })}>
              {Object.entries(pendingCounts).map(([entity, count]) => (
                <span key={entity} className={styles.pendingRow}>
                  🟡 {ENTITY_LABELS[entity as SubmissionEntity]}　{count}件
                </span>
              ))}
            </button>
          </section>
        )}

        {/* ── 見る・探す（Home IA整理 v1、2026-09-14） ── */}
        <section className={styles.section}>
          <div className={styles.sectionHeader}>
            <h2 className={styles.sectionTitle}>見る・探す</h2>
          </div>
          <div className={styles.navRow}>
            <button className={styles.navBtn} onClick={() => go({ name: 'zukan' })}>
              <span className={styles.navIcon}>📚</span>
              <span>図鑑</span>
            </button>
            <button className={styles.navBtn} onClick={() => go({ name: 'zukanFieldMap', from: { name: 'home' } })}>
              <span className={styles.navIcon}>📍</span>
              <span>フィールドマップ</span>
            </button>
          </div>
          <div className={styles.navRow}>
            <button className={styles.navBtn} onClick={() => go({ name: 'processing' })}>
              <span className={styles.navIcon}>🧂</span>
              <span>加工・作業</span>
            </button>
            <button className={styles.navBtn} onClick={() => go({ name: 'list' })}>
              <span className={styles.navIcon}>🍷</span>
              <span>ワイン</span>
            </button>
          </div>
          <div className={styles.navRowSecondary}>
            <button className={styles.navBtnSecondary} onClick={() => go({ name: 'spotList' })}>
              <span>スポット</span>
            </button>
          </div>
        </section>

        {/* ── 最近の記録（Home IA整理 v1、2026-09-14。フィールド/加工・作業/ワインを同じ階層へ統合） ── */}
        {(recentObservations.length > 0 || recentProcessing.length > 0 || recent.length > 0) && (
          <section className={styles.section}>
            <div className={styles.sectionHeader}>
              <h2 className={styles.sectionTitle}>最近の記録</h2>
            </div>

            {recentObservations.length > 0 && (
              <div className={styles.miniGroup}>
                <div className={styles.sectionHeader}>
                  <h2 className={styles.sectionTitle}>最近のフィールド</h2>
                  <button className={styles.viewAll} onClick={() => go({ name: 'field' })}>もっと見る</button>
                </div>
                <div className={styles.thumbnails}>
                  {recentObservations.map(item => (
                    <div key={item.eventId} className={styles.thumb}>
                      {item.photoUrl ? (
                        <img src={item.photoUrl} alt="" className={styles.thumbImg} />
                      ) : (
                        <div className={styles.thumbPlaceholder}>🌿</div>
                      )}
                      <p className={styles.thumbName}>{item.food}</p>
                      <p className={styles.thumbDate}>{item.date.slice(5)}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {recentProcessing.length > 0 && (
              <div className={styles.miniGroup}>
                <div className={styles.sectionHeader}>
                  <h2 className={styles.sectionTitle}>最近の加工・作業</h2>
                  <button className={styles.viewAll} onClick={() => go({ name: 'processing' })}>もっと見る</button>
                </div>
                <ul className={styles.miniList}>
                  {recentProcessing.map(item => (
                    <li key={item.workId} className={styles.miniItemRow}>
                      <button
                        type="button"
                        className={styles.miniItem}
                        onClick={() => go({ name: 'workDetail', workId: item.workId })}
                      >
                        <span className={styles.miniName}>{item.processingName}</span>
                        <span className={styles.miniDate}>{item.datetime.slice(5, 10)}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {recent.length > 0 && (
              <div className={styles.miniGroup}>
                <div className={styles.sectionHeader}>
                  <h2 className={styles.sectionTitle}>最近のワイン</h2>
                  <button
                    className={styles.viewAll}
                    onClick={() => go({ name: 'list' })}
                  >
                    もっと見る
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
              </div>
            )}
          </section>
        )}
      </main>
    </div>
  );
}
