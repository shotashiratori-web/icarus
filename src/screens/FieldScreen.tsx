import { useEffect, useState } from 'react';
import { FIELD_MAP_URL } from '../config';
import { fetchRecentFieldObservations, NetworkUnknownError } from '../api/fieldApi';
import { TokenExpiredError } from '../api/icarusApi';
import { useAuth } from '../context/AuthContext';
import type { FieldObservation } from '../types/fieldLog';
import type { Screen } from '../App';
import styles from './FieldScreen.module.css';

type Props = { go: (s: Screen) => void };
type LoadState = 'loading' | 'ready' | 'error';

export default function FieldScreen({ go }: Props) {
  const { idToken, authState, signInContainerRef, handleTokenExpired } = useAuth();
  const [items, setItems] = useState<FieldObservation[]>([]);
  const [state, setState] = useState<LoadState>('loading');
  const [errorMessage, setErrorMessage] = useState('');

  const load = async (token: string) => {
    setState('loading');
    try {
      const result = await fetchRecentFieldObservations(token, 20);
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
        <span className={styles.title}>📍 フィールド</span>
      </header>

      <main className={styles.main}>
        <button
          className={styles.mapBtn}
          onClick={() => {
            window.location.href = FIELD_MAP_URL;
          }}
        >
          <span className={styles.mapIcon}>🗺️</span>
          <span>フィールドマップを開く</span>
        </button>

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>最近の観察</h2>

          {(authState === 'checking' || (authState === 'ready' && state === 'loading')) && (
            <div className={styles.skeletonList}>
              {[0, 1, 2].map((i) => (
                <div key={i} className={styles.skeletonItem} />
              ))}
            </div>
          )}

          {authState === 'signedOut' && (
            <div className={styles.signInBox}>
              <p className={styles.hintText}>ログインすると最近の観察を確認できます</p>
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
            <p className={styles.empty}>最近の観察はありません。</p>
          )}

          {state === 'ready' && items.length > 0 && (
            <div className={styles.list}>
              {items.map((item) => (
                <div key={item.eventId} className={styles.item}>
                  {item.photoUrl ? (
                    <img src={item.photoUrl} alt="" className={styles.photo} loading="lazy" />
                  ) : (
                    <div className={styles.photoPlaceholder}>🌿</div>
                  )}
                  <div className={styles.info}>
                    <p className={styles.name}>{item.food || '名称未設定'}</p>
                    <p className={styles.sub}>{[item.place, item.phase].filter(Boolean).join(' · ')}</p>
                    <p className={styles.date}>{item.date}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </main>

      <div className={styles.footer}>
        <button className={styles.cta} onClick={() => go({ name: 'foodLog' })}>
          🌿 食材ログを送る
        </button>
      </div>
    </div>
  );
}
