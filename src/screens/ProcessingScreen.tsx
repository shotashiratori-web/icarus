import { useEffect, useState } from 'react';
import { TokenExpiredError } from '../api/icarusApi';
import { useAuth } from '../context/AuthContext';
import {
  useWorkSearchStore, isFiltered, type HasPhotoOption, type WorkSearchConditions,
} from '../store/workSearchStore';
import { listWorkLogDrafts, type WorkLogDraft } from '../db/localDB';
import type { Screen } from '../App';
import styles from './ProcessingScreen.module.css';

type Props = { go: (s: Screen) => void };

const HAS_PHOTO_LABELS: Record<HasPhotoOption, string> = {
  all: 'すべて',
  withPhoto: '写真あり',
  withoutPhoto: '写真なし',
};
const HAS_PHOTO_OPTIONS: HasPhotoOption[] = ['all', 'withPhoto', 'withoutPhoto'];

function resultCountText(applied: WorkSearchConditions, totalCount: number, shown: number): string {
  const label = isFiltered(applied) ? '検索結果' : '全';
  return `${label}${totalCount}件中${shown}件を表示`;
}

// Draft Identity Fix + 明示的Draft Resume。まだSubmission Queueを持たないため、失敗/未送信を
// 区別せず「送信が完了していないdraft」として一律に表示する（Completion BでSubmission Queueと
// 統合後はPending Listへ寄せる想定、詳細はproject memory参照）
function draftLabel(draft: WorkLogDraft): string {
  if (draft.mode === 'create') return draft.title || '（無題の作業）';
  return `記録を追加: ${draft.workId ?? ''}`;
}

function draftSavedAtLabel(savedAt: string): string {
  const d = new Date(savedAt);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export default function ProcessingScreen({ go }: Props) {
  const { idToken, authState, signInContainerRef, handleTokenExpired } = useAuth();
  const store = useWorkSearchStore();
  const [drafts, setDrafts] = useState<WorkLogDraft[]>([]);

  useEffect(() => {
    if (authState === 'ready' && idToken) {
      store.ensureLoaded(idToken).catch((e) => {
        if (e instanceof TokenExpiredError) handleTokenExpired();
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authState, idToken]);

  useEffect(() => {
    void listWorkLogDrafts().then(setDrafts);
  }, []);

  const openDraft = (draft: WorkLogDraft) => {
    if (draft.mode === 'append' && draft.workId) {
      go({ name: 'workForm', mode: 'append', workId: draft.workId, draftRequestId: draft.requestId });
      return;
    }
    go({ name: 'workForm', mode: 'create', draftRequestId: draft.requestId });
  };

  const submit = () => {
    if (!idToken) return;
    store.applyDraft(idToken).catch((e) => {
      if (e instanceof TokenExpiredError) handleTokenExpired();
    });
  };

  const handleClear = () => {
    if (!idToken) return;
    store.clear(idToken).catch((e) => {
      if (e instanceof TokenExpiredError) handleTokenExpired();
    });
  };

  const handleRetry = () => {
    if (!idToken) return;
    store.retry(idToken).catch((e) => {
      if (e instanceof TokenExpiredError) handleTokenExpired();
    });
  };

  const handleLoadMore = () => {
    if (!idToken) return;
    store.loadMore(idToken).catch((e) => {
      if (e instanceof TokenExpiredError) handleTokenExpired();
    });
  };

  const isBusy = store.loadState === 'loading' || store.loadState === 'searching';
  const filtered = isFiltered(store.applied);
  const panelFiltered = store.applied.dateStart !== '' || store.applied.dateEnd !== '' || store.applied.hasPhotoOption !== 'all';
  const showInitialSkeleton = authState === 'checking' || (authState === 'ready' && store.loadState === 'loading');
  const showFullError = authState === 'ready' && store.loadState === 'error' && store.items.length === 0;
  const showInlineError = store.loadState === 'error' && store.items.length > 0;
  const showEmpty = store.loadState === 'ready' && store.items.length === 0;
  const showList = store.items.length > 0;

  return (
    <div className={styles.root}>
      <header className={styles.header}>
        <button className={styles.back} onClick={() => go({ name: 'home' })}>← Home</button>
        <span className={styles.title}>🧂 加工</span>
      </header>

      <main className={styles.main}>
        <button className={styles.newWorkBtn} onClick={() => go({ name: 'workForm', mode: 'create' })}>
          ＋ 新しい作業を始める
        </button>

        {drafts.length > 0 && (
          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>未送信の下書き　{drafts.length}件</h2>
            <div className={styles.draftList}>
              {drafts.map((draft) => (
                <button key={draft.requestId} className={styles.draftItem} onClick={() => openDraft(draft)}>
                  <div className={styles.draftInfo}>
                    <p className={styles.draftTitle}>{draftLabel(draft)}</p>
                    <p className={styles.draftMeta}>{draftSavedAtLabel(draft.savedAt)}</p>
                  </div>
                  <span className={styles.draftEditLink}>続きを編集</span>
                </button>
              ))}
            </div>
          </section>
        )}

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>最近の作業</h2>

          {authState === 'ready' && (
            <>
              <div className={styles.searchBar}>
                <input
                  className={styles.searchInput}
                  type="text"
                  value={store.draft.query}
                  disabled={isBusy}
                  placeholder="作業ID・内容・キャプションで検索"
                  onChange={(e) => store.setDraftQuery(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
                />
                <button className={styles.searchBtn} disabled={isBusy} onClick={submit}>検索</button>
              </div>

              <div className={styles.searchActions}>
                <button
                  className={styles.filterToggleBtn}
                  onClick={() => store.setFilterPanelOpen(!store.filterPanelOpen)}
                  aria-expanded={store.filterPanelOpen}
                >
                  絞り込み{panelFiltered ? ' ●' : ''}
                </button>
                <button className={styles.clearBtn} disabled={isBusy} onClick={handleClear}>クリア</button>
              </div>

              {store.filterPanelOpen && (
                <div className={styles.filterPanel}>
                  <div className={styles.filterRow}>
                    <label className={styles.filterLabel}>開始日</label>
                    <input
                      className={styles.dateInput}
                      type="date"
                      value={store.draft.dateStart}
                      disabled={isBusy}
                      onChange={(e) => store.setDraftDateStart(e.target.value)}
                    />
                  </div>
                  <div className={styles.filterRow}>
                    <label className={styles.filterLabel}>終了日</label>
                    <input
                      className={styles.dateInput}
                      type="date"
                      value={store.draft.dateEnd}
                      disabled={isBusy}
                      onChange={(e) => store.setDraftDateEnd(e.target.value)}
                    />
                  </div>
                  {store.dateRangeError && <p className={styles.fieldError}>{store.dateRangeError}</p>}

                  <div className={styles.filterRow}>
                    <span className={styles.filterLabel}>写真</span>
                    <div className={styles.radioGroup}>
                      {HAS_PHOTO_OPTIONS.map((opt) => (
                        <label key={opt} className={styles.radioLabel}>
                          <input
                            type="radio"
                            name="hasPhotoOption"
                            checked={store.draft.hasPhotoOption === opt}
                            disabled={isBusy}
                            onChange={() => store.setDraftHasPhotoOption(opt)}
                          />
                          {HAS_PHOTO_LABELS[opt]}
                        </label>
                      ))}
                    </div>
                  </div>

                  <button className={styles.applyFilterBtn} disabled={isBusy} onClick={submit}>絞り込みを適用</button>
                </div>
              )}

              {store.hasLoadedOnce && store.totalCount > 0 && (
                <p className={styles.resultCount}>{resultCountText(store.applied, store.totalCount, store.items.length)}</p>
              )}
              {store.loadState === 'searching' && <p className={styles.searchingHint}>検索中…</p>}
            </>
          )}

          {showInitialSkeleton && (
            <div className={styles.skeletonList}>
              {[0, 1, 2].map((i) => (
                <div key={i} className={styles.skeletonItem} />
              ))}
            </div>
          )}

          {authState === 'signedOut' && (
            <div className={styles.signInBox}>
              <p className={styles.hintText}>ログインすると最近の作業を確認できます</p>
              <div ref={signInContainerRef} />
            </div>
          )}

          {showFullError && (
            <div className={styles.errorBox}>
              <p className={styles.errorText}>{store.errorMessage}</p>
              <button className={styles.retryBtn} onClick={handleRetry}>再読み込み</button>
            </div>
          )}

          {showInlineError && (
            <div className={styles.inlineErrorBox}>
              <p className={styles.errorText}>{store.errorMessage}</p>
              <button className={styles.retryBtn} onClick={handleRetry}>再試行</button>
            </div>
          )}

          {showEmpty && (
            <div className={styles.empty}>
              <p>{filtered ? '条件に一致する作業はありません' : '最近の作業はありません。'}</p>
              {filtered && <button className={styles.clearLinkBtn} onClick={handleClear}>条件をクリア</button>}
            </div>
          )}

          {showList && (
            <div className={styles.list}>
              {store.items.map((item) => (
                <button
                  key={item.workId}
                  className={styles.item}
                  onClick={() => go({ name: 'workDetail', workId: item.workId })}
                >
                  {item.representativePhotoUrl ? (
                    <img src={item.representativePhotoUrl} alt="" className={styles.photo} loading="lazy" />
                  ) : (
                    <div className={styles.photoPlaceholder}>🧂</div>
                  )}
                  <div className={styles.info}>
                    <div className={styles.titleRow}>
                      <p className={styles.name}>{item.title || '無題の作業'}</p>
                      <span className={styles.workId}>{item.workId}</span>
                    </div>
                    {item.summary && <p className={styles.sub}>{item.summary}</p>}
                    <div className={styles.metaRow}>
                      <span className={styles.date}>{item.lastUpdatedAt.slice(0, 16).replace('T', ' ')}</span>
                      {item.type && <span className={styles.typeTag}>{item.type}</span>}
                      {item.photoCount > 0 && <span className={styles.photoCountTag}>📷 {item.photoCount}</span>}
                    </div>
                    {item.startDate && (
                      <p className={styles.startDate}>開始: {item.startDate.slice(0, 10)}</p>
                    )}
                  </div>
                </button>
              ))}
            </div>
          )}

          {showList && store.loadMoreError && (
            <div className={styles.inlineErrorBox}>
              <p className={styles.errorText}>{store.loadMoreError}</p>
              <button className={styles.retryBtn} onClick={handleLoadMore}>再試行</button>
            </div>
          )}

          {showList && store.hasMore && (
            <button
              className={styles.loadMoreBtn}
              disabled={store.isLoadingMore || isBusy}
              onClick={handleLoadMore}
            >
              {store.isLoadingMore ? '読み込み中…' : `残り${store.totalCount - store.items.length}件を読み込む`}
            </button>
          )}
        </section>
      </main>
    </div>
  );
}
