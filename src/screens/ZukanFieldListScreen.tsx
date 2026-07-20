import { useEffect, useMemo, useState } from 'react';
import { fetchFieldLogEntries, NetworkUnknownError } from '../api/zukanApi';
import type { FieldLogEntry } from '../types/zukan';
import type { Screen } from '../App';
import styles from './ZukanFieldListScreen.module.css';

type Props = { go: (s: Screen) => void };
type LoadState = 'loading' | 'ready' | 'error';

export default function ZukanFieldListScreen({ go }: Props) {
  const [state, setState] = useState<LoadState>('loading');
  const [errorMessage, setErrorMessage] = useState('');
  const [entries, setEntries] = useState<FieldLogEntry[]>([]);
  const [query, setQuery] = useState('');
  const [kigoFilter, setKigoFilter] = useState('');

  const load = async () => {
    setState('loading');
    try {
      const items = await fetchFieldLogEntries();
      items.sort((a, b) => b.date.localeCompare(a.date));
      setEntries(items);
      setState('ready');
    } catch (e) {
      setErrorMessage(e instanceof NetworkUnknownError ? e.message : e instanceof Error ? e.message : '取得に失敗しました');
      setState('error');
    }
  };

  useEffect(() => { void load(); }, []);

  const kigoOptions = useMemo(() => {
    const set = new Set(entries.map((e) => e.kigo).filter(Boolean));
    return Array.from(set).sort();
  }, [entries]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return entries.filter((e) => {
      if (kigoFilter && e.kigo !== kigoFilter) return false;
      if (!q) return true;
      return [e.foodName, e.place, e.memo, e.kigo].some((v) => v.toLowerCase().includes(q));
    });
  }, [entries, query, kigoFilter]);

  return (
    <div className={styles.root}>
      <header className={styles.header}>
        <button className={styles.back} onClick={() => go({ name: 'zukan' })}>← 図鑑</button>
        <span className={styles.title}>🌱 フィールド</span>
      </header>

      <main className={styles.main}>
        {state === 'loading' && (
          <div className={styles.skeletonGrid}>
            {[0, 1, 2, 3].map((i) => (<div key={i} className={styles.skeletonCard} />))}
          </div>
        )}

        {state === 'error' && (
          <div className={styles.errorBox}>
            <p className={styles.errorText}>{errorMessage}</p>
            <button className={styles.retryBtn} onClick={() => load()}>再読み込み</button>
          </div>
        )}

        {state === 'ready' && (
          <>
            <div className={styles.filters}>
              <input
                className={styles.searchInput}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
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
                <button key={entry.id} className={styles.card} onClick={() => go({ name: 'zukanFieldDetail', entry })}>
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
