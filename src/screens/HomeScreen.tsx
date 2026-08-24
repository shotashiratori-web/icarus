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
        <button className={styles.settingsBtn}>設定</button>
      </header>

      <main className={styles.main}>
        {authState === 'signedOut' && (
          <div className={styles.signInBox}>
            <p className={styles.signInText}>ログインが切れています。再度ログインしてください。</p>
            <div ref={signInContainerRef} />
          </div>
        )}

        {/* ── 今日やる ── */}
        <section className={styles.section}>
          <div className={styles.sectionHeader}>
            <h2 className={styles.sectionTitle}>今日やる</h2>
          </div>
          <button
            className={styles.cta}
            onClick={() => go({ name: 'foodLog' })}
          >
            <span className={styles.ctaIcon}>🌿</span>
            <span className={styles.ctaLabel}>フィールドログを記録</span>
            <span className={styles.ctaArrow}>→ 記録</span>
          </button>
          <button
            className={styles.cta}
            onClick={() => go({ name: 'workForm', mode: 'create' })}
          >
            <span className={styles.ctaIcon}>🧂</span>
            <span className={styles.ctaLabel}>作業ログを記録</span>
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

        {/* ── 見る・調べる ── */}
        <section className={styles.section}>
          <div className={styles.sectionHeader}>
            <h2 className={styles.sectionTitle}>見る・調べる</h2>
          </div>
          <div className={styles.navRow}>
            <button className={styles.navBtn} onClick={() => go({ name: 'foodEncyclopediaList' })}>
              <span className={styles.navIcon}>📚</span>
              <span>食材図鑑</span>
            </button>
            <button className={styles.navBtn} onClick={() => go({ name: 'zukanFieldMap', from: { name: 'home' } })}>
              <span className={styles.navIcon}>📍</span>
              <span>フィールドマップ</span>
            </button>
          </div>
          <div className={styles.navRowSecondary}>
            <button className={styles.navBtnSecondary} onClick={() => go({ name: 'list' })}>
              <span>ワイン</span>
            </button>
            <button className={styles.navBtnSecondary} onClick={() => go({ name: 'spotList' })}>
              <span>スポット</span>
            </button>
          </div>
        </section>

        {/* ── 最近の観察（写真つき） ── */}
        {recentObservations.length > 0 && (
          <section className={styles.section}>
            <div className={styles.sectionHeader}>
              <h2 className={styles.sectionTitle}>最近の観察</h2>
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
          </section>
        )}

        {recentProcessing.length > 0 && (
          <section className={styles.section}>
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
          </section>
        )}

        {/* ── 管理・編集 ── */}
        <section className={styles.section}>
          <div className={styles.sectionHeader}>
            <h2 className={styles.sectionTitle}>管理・編集</h2>
          </div>

          <button
            className={styles.cta}
            onClick={() => go({ name: 'record', noteId: null })}
          >
            <span className={styles.ctaIcon}>✏️</span>
            <span className={styles.ctaLabel}>新しいワインノート</span>
            <span className={styles.ctaArrow}>→ 作る</span>
          </button>

          {staffMe && (
            <div className={styles.navRow}>
              <button className={styles.navBtn} onClick={() => go({ name: 'daily' })}>
                <span className={styles.navIcon}>📝</span>
                <span>Lift Up Daily</span>
              </button>
              <button className={styles.navBtn} onClick={() => go({ name: 'zukan' })}>
                <span className={styles.navIcon}>📚</span>
                <span>図鑑（試作版）</span>
              </button>
            </div>
          )}

          {staffMe && (
            <div className={styles.navRow}>
              <button className={styles.navBtn} onClick={() => go({ name: 'photoBulkUpload' })}>
                <span className={styles.navIcon}>🗂️</span>
                <span>PC一括写真送信</span>
              </button>
            </div>
          )}

          {staffMe?.role === 'admin' && (
            <div className={styles.navRow}>
              <button className={styles.navBtn} onClick={() => go({ name: 'processEditor' })}>
                <span className={styles.navIcon}>🧬</span>
                <span>加工知識を登録</span>
              </button>
              <button className={styles.navBtn} onClick={() => go({ name: 'foodEditorList' })}>
                <span className={styles.navIcon}>🥕</span>
                <span>Foodを登録・編集</span>
              </button>
              <button className={styles.navBtn} onClick={() => go({ name: 'staffApproval' })}>
                <span className={styles.navIcon}>🛡️</span>
                <span>スタッフ管理</span>
              </button>
              <button className={styles.navBtn} onClick={() => go({ name: 'dailyAdmin' })}>
                <span className={styles.navIcon}>📋</span>
                <span>Daily確認</span>
              </button>
              <button className={styles.navBtn} onClick={() => go({ name: 'spotList' })}>
                <span className={styles.navIcon}>📍</span>
                <span>スポット管理</span>
              </button>
              <button className={styles.navBtn} onClick={() => go({ name: 'metaDebug' })}>
                <span className={styles.navIcon}>🔬</span>
                <span>画像メタデータ調査</span>
              </button>
              <button className={styles.navBtn} onClick={() => go({ name: 'photoHashRepair' })}>
                <span className={styles.navIcon}>🩹</span>
                <span>写真ハッシュ補完</span>
              </button>
            </div>
          )}

          {/* 最近のワインノート */}
          {recent.length > 0 && (
            <div className={styles.miniGroup}>
              <div className={styles.sectionHeader}>
                <h2 className={styles.sectionTitle}>最近のワインノート</h2>
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
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
