import { useEffect, useMemo, useState } from 'react';
import { fetchSpots } from '../api/spotEntityApi';
import { NetworkUnknownError } from '../api/workApi';
import { TokenExpiredError } from '../api/icarusApi';
import { useAuth } from '../context/AuthContext';
import type { SpotEntity } from '../types/spotEntity';
import type { Screen } from '../App';
import styles from './SpotListScreen.module.css';

type Props = { go: (s: Screen) => void };
type LoadState = 'loading' | 'ready' | 'error';
type SortKey = 'added' | 'updated' | 'title';

export default function SpotListScreen({ go }: Props) {
  const { idToken, authState, signInContainerRef, handleTokenExpired } = useAuth();
  const [items, setItems] = useState<SpotEntity[]>([]);
  const [state, setState] = useState<LoadState>('loading');
  const [errorMessage, setErrorMessage] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('added');
  const [categoryFilter, setCategoryFilter] = useState('');

  const load = async (token: string) => {
    setState('loading');
    try {
      const result = await fetchSpots({}, token);
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

  const categoryOptions = useMemo(() => {
    const set = new Set(items.map((s) => s.category).filter(Boolean));
    return Array.from(set).sort();
  }, [items]);

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const list = items.filter((s) => {
      if (categoryFilter && s.category !== categoryFilter) return false;
      if (!q) return true;
      return [s.title, s.category].some((v) => v.toLowerCase().includes(q));
    });
    const sorted = [...list];
    if (sortKey === 'title') sorted.sort((a, b) => a.title.localeCompare(b.title, 'ja'));
    else if (sortKey === 'updated') sorted.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    else sorted.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return sorted;
  }, [items, searchQuery, sortKey, categoryFilter]);

  return (
    <div className={styles.root}>
      <header className={styles.header}>
        <button className={styles.back} onClick={() => go({ name: 'home' })}>← ホーム</button>
        <span className={styles.title}>📍 スポット管理</span>
        <button className={styles.addBtn} onClick={() => go({ name: 'spotForm', mode: 'create' })}>+ 追加</button>
      </header>

      <main className={styles.main}>
        {(authState === 'checking' || (authState === 'ready' && state === 'loading')) && (
          <div className={styles.skeletonGrid}>
            {[0, 1, 2, 3].map((i) => (<div key={i} className={styles.skeletonCard} />))}
          </div>
        )}

        {authState === 'signedOut' && (
          <div className={styles.signInBox}>
            <p className={styles.hintText}>ログインするとスポットを確認できます</p>
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
                placeholder="名前・種別で検索"
              />
              <select className={styles.sortSelect} value={sortKey} onChange={(e) => setSortKey(e.target.value as SortKey)}>
                <option value="added">追加が新しい順</option>
                <option value="updated">更新順</option>
                <option value="title">名前順</option>
              </select>
            </div>

            {categoryOptions.length > 0 && (
              <div className={styles.kigoBar}>
                <button className={`${styles.kBtn} ${!categoryFilter ? styles.kBtnActive : ''}`} onClick={() => setCategoryFilter('')}>
                  すべて
                </button>
                {categoryOptions.map((c) => (
                  <button key={c} className={`${styles.kBtn} ${categoryFilter === c ? styles.kBtnActive : ''}`} onClick={() => setCategoryFilter(c)}>
                    {c}
                  </button>
                ))}
              </div>
            )}

            <p className={styles.count}>{filtered.length}件</p>

            {filtered.length === 0 && <p className={styles.empty}>該当するスポットはありません</p>}

            <div className={styles.grid}>
              {filtered.map((spot) => (
                <button key={spot.id} className={styles.card} onClick={() => go({ name: 'spotDetail', entry: spot })}>
                  <div className={styles.photoWrap}>
                    {spot.photos[0]
                      ? <img className={styles.photo} src={spot.photos[0]} alt={spot.title} loading="lazy" />
                      : <div className={styles.photoPlaceholder}>📍</div>}
                  </div>
                  <div className={styles.cardBody}>
                    <span className={styles.entryTitle}>{spot.title}</span>
                    {spot.category && <span className={styles.tag}>{spot.category}</span>}
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
