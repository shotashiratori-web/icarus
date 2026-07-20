import { useEffect, useMemo, useRef } from 'react';
import { useZukanFieldStore } from '../store/zukanFieldStore';
import type { Screen } from '../App';
import styles from './ZukanFieldListScreen.module.css';

type Props = { go: (s: Screen) => void };

export default function ZukanFieldListScreen({ go }: Props) {
  const {
    entries, loadState, errorMessage,
    searchQuery, kigoFilter, listScrollTop,
    ensureLoaded, reload, setSearchQuery, setKigoFilter, setListScrollTop,
  } = useZukanFieldStore();

  const mainRef = useRef<HTMLElement | null>(null);

  // ①一覧・地図で同じデータを共有する。既に読み込み済みなら再fetchしない
  useEffect(() => { void ensureLoaded(); }, [ensureLoaded]);

  // ②地図往復後もスクロール位置を保持する。読み込み完了後に一度だけ復元する
  useEffect(() => {
    if (loadState === 'ready' && mainRef.current) {
      mainRef.current.scrollTop = listScrollTop;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadState]);

  const handleScroll = () => {
    if (mainRef.current) setListScrollTop(mainRef.current.scrollTop);
  };

  const kigoOptions = useMemo(() => {
    const set = new Set(entries.map((e) => e.kigo).filter(Boolean));
    return Array.from(set).sort();
  }, [entries]);

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return entries.filter((e) => {
      if (kigoFilter && e.kigo !== kigoFilter) return false;
      if (!q) return true;
      return [e.foodName, e.place, e.memo, e.kigo].some((v) => v.toLowerCase().includes(q));
    });
  }, [entries, searchQuery, kigoFilter]);

  const openDetail = (entry: (typeof entries)[number]) => {
    go({ name: 'zukanFieldDetail', entry, from: { name: 'zukanFieldList' } });
  };

  return (
    <div className={styles.root}>
      <header className={styles.header}>
        <button className={styles.back} onClick={() => go({ name: 'zukan' })}>← 図鑑</button>
        <span className={styles.title}>🌱 フィールド</span>
        <button
          className={styles.mapBtn}
          onClick={() => go({ name: 'zukanFieldMap', from: { name: 'zukanFieldList' } })}
        >
          🗺️ マップで見る
        </button>
      </header>

      <main className={styles.main} ref={mainRef} onScroll={handleScroll}>
        {loadState === 'loading' && (
          <div className={styles.skeletonGrid}>
            {[0, 1, 2, 3].map((i) => (<div key={i} className={styles.skeletonCard} />))}
          </div>
        )}

        {loadState === 'error' && (
          <div className={styles.errorBox}>
            <p className={styles.errorText}>{errorMessage}</p>
            <button className={styles.retryBtn} onClick={() => reload()}>再読み込み</button>
          </div>
        )}

        {loadState === 'ready' && (
          <>
            <div className={styles.filters}>
              <input
                className={styles.searchInput}
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="食材名・場所・メモで検索"
              />
              {kigoOptions.length > 0 && (
                <select className={styles.select} value={kigoFilter} onChange={(e) => setKigoFilter(e.target.value)}>
                  <option value="">すべてのタグ</option>
                  {kigoOptions.map((k) => (<option key={k} value={k}>{k}</option>))}
                </select>
              )}
            </div>

            <p className={styles.count}>{filtered.length}件の観察記録</p>

            {filtered.length === 0 && <p className={styles.empty}>該当する観察記録はありません</p>}

            <div className={styles.grid}>
              {filtered.map((entry) => (
                <button key={entry.id} className={styles.card} onClick={() => openDetail(entry)}>
                  <div className={styles.photoWrap}>
                    {entry.photoUrl
                      ? <img className={styles.photo} src={entry.photoUrl} alt={entry.foodName} loading="lazy" />
                      : <div className={styles.photoPlaceholder}>写真なし</div>}
                  </div>
                  <div className={styles.cardBody}>
                    <span className={styles.foodName}>{entry.foodName || '無題'}</span>
                    <span className={styles.metaRow}>
                      <span className={styles.place}>📍 {entry.place || '場所不明'}</span>
                      <span className={styles.date}>{entry.date}</span>
                    </span>
                    {entry.kigo && <span className={styles.tag}>{entry.kigo}</span>}
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
