import { useEffect, useMemo, useState } from 'react';
import { fetchWines } from '../api/wineEntityApi';
import { NetworkUnknownError } from '../api/workApi';
import { TokenExpiredError } from '../api/icarusApi';
import { useAuth } from '../context/AuthContext';
import type { WineEntity } from '../types/wineEntity';
import type { Screen } from '../App';
import styles from './WineListScreen.module.css';

type Props = { go: (s: Screen) => void };
type LoadState = 'loading' | 'ready' | 'error';
type SortKey = 'updated' | 'title';

export default function WineListScreen({ go }: Props) {
  const { idToken, authState, signInContainerRef, handleTokenExpired } = useAuth();
  const [items, setItems] = useState<WineEntity[]>([]);
  const [state, setState] = useState<LoadState>('loading');
  const [errorMessage, setErrorMessage] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('updated');

  const load = async (token: string) => {
    setState('loading');
    try {
      const result = await fetchWines({}, token);
      setItems(result);
      setState('ready');
    } catch (e) {
      if (e instanceof TokenExpiredError) { handleTokenExpired(); return; }
      setErrorMessage(e instanceof NetworkUnknownError ? e.message : e instanceof Error ? e.message : '取得に失敗しました');
      setState('error');
    }
  };

  useEffect(() => {
    if (authState === 'ready' && idToken) void load(idToken);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authState, idToken]);

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const list = q
      ? items.filter((w) => [w.title, w.producer, w.variety, w.origin].some((v) => v.toLowerCase().includes(q)))
      : items;
    const sorted = [...list];
    if (sortKey === 'title') sorted.sort((a, b) => a.title.localeCompare(b.title, 'ja'));
    else sorted.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return sorted;
  }, [items, searchQuery, sortKey]);

  return (
    <div className={styles.root}>
      <header className={styles.header}>
        <button className={styles.back} onClick={() => go({ name: 'zukan' })}>← 図鑑</button>
        <span className={styles.title}>🍷 ワイン</span>
        <button className={styles.addBtn} onClick={() => go({ name: 'wineForm', mode: 'create' })}>+ 追加</button>
      </header>

      <main className={styles.main}>
        {(authState === 'checking' || (authState === 'ready' && state === 'loading')) && (
          <div className={styles.skeletonGrid}>
            {[0, 1, 2, 3].map((i) => (<div key={i} className={styles.skeletonCard} />))}
          </div>
        )}

        {authState === 'signedOut' && (
          <div className={styles.signInBox}>
            <p className={styles.hintText}>ログインするとワインを確認できます</p>
            <div ref={signInContainerRef} />
          </div>
        )}

        {authState === 'ready' && state === 'error' && (
          <div className={styles.errorBox}>
            <p className={styles.errorText}>{errorMessage}</p>
            <button className={styles.retryBtn} onClick={() => idToken && load(idToken)}>再読み込み</button>
          </div>
        )}

        {state === 'ready' && (
          <>
            <div className={styles.filters}>
              <input
                className={styles.searchInput}
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="ワイン名・生産者・品種・産地で検索"
              />
              <select className={styles.sortSelect} value={sortKey} onChange={(e) => setSortKey(e.target.value as SortKey)}>
                <option value="updated">更新順</option>
                <option value="title">名前順</option>
              </select>
            </div>

            <p className={styles.count}>{filtered.length}件</p>

            {filtered.length === 0 && <p className={styles.empty}>該当するワインはありません</p>}

            <div className={styles.grid}>
              {filtered.map((wine) => (
                <button key={wine.id} className={styles.card} onClick={() => go({ name: 'wineForm', mode: 'edit', wine })}>
                  <div className={styles.photoWrap}>
                    {wine.photos[0]
                      ? <img className={styles.photo} src={wine.photos[0]} alt={wine.title} loading="lazy" />
                      : <div className={styles.photoPlaceholder}>🍷</div>}
                  </div>
                  <div className={styles.cardBody}>
                    <span className={styles.wineTitle}>{wine.title}</span>
                    <span className={styles.metaRow}>
                      {wine.producer && <span>{wine.producer}</span>}
                      {wine.vintage && <span>{wine.vintage}</span>}
                    </span>
                    {wine.variety && <span className={styles.tag}>{wine.variety}</span>}
                  </div>
                </button>
              ))}
            </div>
          </>
        )}
      </main>
    </div>
  );
}
