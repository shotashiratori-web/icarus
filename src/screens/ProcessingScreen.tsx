import { useEffect, useState } from 'react';
import { searchWorkLogs, NetworkUnknownError } from '../api/workApi';
import { TokenExpiredError } from '../api/icarusApi';
import { useAuth } from '../context/AuthContext';
import type { WorkSearchItem } from '../types/workLog';
import type { Screen } from '../App';
import styles from './ProcessingScreen.module.css';

type Props = { go: (s: Screen) => void };
type LoadState = 'loading' | 'ready' | 'error';

const INITIAL_LIMIT = 20;

export default function ProcessingScreen({ go }: Props) {
  const { idToken, authState, signInContainerRef, handleTokenExpired } = useAuth();
  const [items, setItems] = useState<WorkSearchItem[]>([]);
  // 検索UI・「さらに読み込む」はUnit D/Eで使う。ここでは状態として保持するのみ
  const [totalCount, setTotalCount] = useState(0);
  const [limit, setLimit] = useState(INITIAL_LIMIT);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [state, setState] = useState<LoadState>('loading');
  const [errorMessage, setErrorMessage] = useState('');

  const load = async (token: string) => {
    setState('loading');
    try {
      const result = await searchWorkLogs({ limit: INITIAL_LIMIT, offset: 0 }, token);
      setItems(result.items);
      setTotalCount(result.totalCount);
      setLimit(result.limit);
      setOffset(result.offset);
      setHasMore(result.hasMore);
      setState('ready');
    } catch (e) {
      if (e instanceof TokenExpiredError) {
        handleTokenExpired();
        return;
      }
      setErrorMessage(
        e instanceof NetworkUnknownError ? e.message : e instanceof Error ? e.message : '取得に失敗しました',
      );
      setState('error');
    }
  };

  const retry = () => {
    if (idToken) void load(idToken);
  };

  useEffect(() => {
    if (authState === 'ready' && idToken) void load(idToken);
  }, [authState, idToken]);

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

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>最近の作業{state === 'ready' && totalCount > 0 ? `（全${totalCount}件）` : ''}</h2>

          {(authState === 'checking' || (authState === 'ready' && state === 'loading')) && (
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

          {authState === 'ready' && state === 'error' && (
            <div className={styles.errorBox}>
              <p className={styles.errorText}>{errorMessage}</p>
              <button className={styles.retryBtn} onClick={retry}>再読み込み</button>
            </div>
          )}

          {state === 'ready' && items.length === 0 && (
            <p className={styles.empty}>最近の作業はありません。</p>
          )}

          {state === 'ready' && items.length > 0 && (
            <div className={styles.list}>
              {items.map((item) => (
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
        </section>
      </main>
    </div>
  );
}
