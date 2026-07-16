import { useEffect, useState } from 'react';
import { fetchRecentWorkLogs, NetworkUnknownError } from '../api/fieldApi';
import { TokenExpiredError } from '../api/icarusApi';
import { useAuth } from '../context/AuthContext';
import type { WorkLogItem } from '../types/fieldLog';
import type { Screen } from '../App';
import styles from './ProcessingScreen.module.css';

type Props = { go: (s: Screen) => void };
type LoadState = 'loading' | 'ready' | 'error';

export default function ProcessingScreen({ go }: Props) {
  const { idToken, authState, signInContainerRef, handleTokenExpired } = useAuth();
  const [items, setItems] = useState<WorkLogItem[]>([]);
  const [state, setState] = useState<LoadState>('loading');
  const [errorMessage, setErrorMessage] = useState('');

  const load = async (token: string) => {
    setState('loading');
    try {
      const result = await fetchRecentWorkLogs(token, 20);
      setItems(result);
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
          <h2 className={styles.sectionTitle}>最近の作業</h2>

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
                  {item.photoUrl ? (
                    <img src={item.photoUrl} alt="" className={styles.photo} loading="lazy" />
                  ) : (
                    <div className={styles.photoPlaceholder}>🧂</div>
                  )}
                  <div className={styles.info}>
                    <p className={styles.name}>{item.processingName || '無題の作業'}</p>
                    {item.memo && <p className={styles.sub}>{item.memo}</p>}
                    <p className={styles.date}>{item.datetime.slice(0, 16).replace('T', ' ')}</p>
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
