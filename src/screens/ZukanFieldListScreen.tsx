import { useEffect, useMemo, useRef } from 'react';
import { MapContainer, TileLayer } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import { useZukanFieldStore } from '../store/zukanFieldStore';
import FieldMarker from './FieldMarker';
import FitFieldBounds from './FitFieldBounds';
import type { FieldLogEntry } from '../types/zukan';
import type { Screen } from '../App';
import styles from './ZukanFieldListScreen.module.css';

type Props = { go: (s: Screen) => void };

export default function ZukanFieldListScreen({ go }: Props) {
  const {
    entries, loadState, errorMessage,
    searchQuery, kigoFilter, listScrollTop,
    ensureLoaded, reload, setSearchQuery, setKigoFilter, setListScrollTop,
  } = useZukanFieldStore();

  const listRef = useRef<HTMLDivElement | null>(null);

  // ①一覧・地図で同じデータを共有する。既に読み込み済みなら再fetchしない
  useEffect(() => { void ensureLoaded(); }, [ensureLoaded]);

  // ②地図往復後もスクロール位置を保持する。読み込み完了後に一度だけ復元する
  useEffect(() => {
    if (loadState === 'ready' && listRef.current) {
      listRef.current.scrollTop = listScrollTop;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadState]);

  const handleScroll = () => {
    if (listRef.current) setListScrollTop(listRef.current.scrollTop);
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

  const openDetail = (entry: FieldLogEntry) => {
    go({ name: 'zukanFieldDetail', entry, from: { name: 'zukanFieldList' } });
  };

  const openFullMap = (focusEntry?: FieldLogEntry) => {
    go({ name: 'zukanFieldMap', focusEntry, from: { name: 'zukanFieldList' } });
  };

  return (
    <div className={styles.root}>
      <header className={styles.header}>
        <button className={styles.back} onClick={() => go({ name: 'zukan' })}>← 図鑑</button>
        <span className={styles.title}>🌱 フィールド</span>
        <button className={styles.mapBtn} onClick={() => openFullMap()}>
          🗺️ フルマップ
        </button>
      </header>

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

          {/* 常に地図と一覧の両方を表示する分割画面。地図は現在の検索・タグ絞り込みと同じ結果を映す */}
          <div className={styles.miniMapWrap}>
            <MapContainer center={[43.1957, 140.7835]} zoom={11} className={styles.miniMap}>
              <TileLayer
                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              />
              <FitFieldBounds matched={filtered} />
              {filtered.map((entry) => (
                <FieldMarker
                  key={entry.id}
                  entry={entry}
                  matched
                  dimMode={false}
                  shouldOpen={false}
                  onOpenDetail={openDetail}
                  compact
                />
              ))}
            </MapContainer>
          </div>

          <div className={styles.listSection}>
            <p className={styles.count}>{filtered.length}件の観察記録</p>

            {filtered.length === 0 && <p className={styles.empty}>該当する観察記録はありません</p>}

            <div
              key={`${searchQuery}::${kigoFilter}`}
              className={styles.grid}
              ref={listRef}
              onScroll={handleScroll}
            >
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
          </div>
        </>
      )}
    </div>
  );
}
