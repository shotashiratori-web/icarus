import { useEffect, useMemo, useRef } from 'react';
import { MapContainer, TileLayer } from 'react-leaflet';
import MarkerClusterGroup from 'react-leaflet-cluster';
import 'leaflet/dist/leaflet.css';
import 'leaflet.markercluster/dist/MarkerCluster.css';
import 'leaflet.markercluster/dist/MarkerCluster.Default.css';
import { useZukanFieldStore } from '../store/zukanFieldStore';
import { computeDateRange, lastYearSameLabel, type TimeFilterKey } from '../utils/fieldTimeFilter';
import { matchesFilter } from '../utils/fieldFilter';
import FieldMapControls from './FieldMapControls';
import FieldMarker from './FieldMarker';
import FitFieldBounds from './FitFieldBounds';
import BottomSheet from './BottomSheet';
import type { FieldLogEntry } from '../types/zukan';
import type { Screen } from '../App';
import styles from './ZukanFieldMapScreen.module.css';

type Props = { go: (s: Screen) => void; focusEntry?: FieldLogEntry; from: Screen };

export default function ZukanFieldMapScreen({ go, focusEntry, from }: Props) {
  const {
    entries, loadState, errorMessage, ensureLoaded, reload,
    searchQuery, kigoFilter, setSearchQuery, setKigoFilter,
    listScrollTop, setListScrollTop, sheetSnap, setSheetSnap,
    timeFilter, setTimeFilter, customDateStart, customDateEnd, setCustomDateRange,
    dimMode, setDimMode,
  } = useZukanFieldStore();

  const listRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => { void ensureLoaded(); }, [ensureLoaded]);

  // 詳細画面から戻ってきたときに、ボトムシート一覧のスクロール位置を復元する
  useEffect(() => {
    if (loadState === 'ready' && listRef.current) {
      listRef.current.scrollTop = listScrollTop;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadState]);

  const handleListScroll = () => {
    if (listRef.current) setListScrollTop(listRef.current.scrollTop);
  };

  const openDetail = (entry: FieldLogEntry) => {
    go({ name: 'zukanFieldDetail', entry, from: { name: 'zukanFieldMap', focusEntry, from } });
  };

  const kigoOptions = useMemo(() => {
    const set = new Set(entries.map((e) => e.kigo).filter(Boolean));
    return Array.from(set).sort();
  }, [entries]);

  const yearOptions = useMemo(() => {
    const set = new Set(entries.map((e) => e.date.slice(0, 4)).filter((y) => y.length === 4));
    return Array.from(set).sort();
  }, [entries]);

  const dateRange = useMemo(
    () => computeDateRange(timeFilter, new Date(), { start: customDateStart, end: customDateEnd }),
    [timeFilter, customDateStart, customDateEnd],
  );

  const matchedEntries = useMemo(
    () => entries.filter((e) => matchesFilter(e, dateRange, kigoFilter, searchQuery)),
    [entries, searchQuery, kigoFilter, dateRange],
  );
  const matchedIds = useMemo(() => new Set(matchedEntries.map((e) => e.id)), [matchedEntries]);

  const isFiltering = timeFilter !== 'all' || !!kigoFilter || !!searchQuery.trim();
  const statusText = useMemo(() => {
    if (searchQuery.trim()) {
      return `🔍 ${searchQuery.trim()} | 表示対象 ${matchedEntries.length}件 / 全${entries.length}件`;
    }
    let base: string;
    if (timeFilter === 'last-year-same') base = `${lastYearSameLabel(new Date())} | 表示対象 ${matchedEntries.length}件 / 全${entries.length}件`;
    else if (isFiltering) base = `表示対象 ${matchedEntries.length}件 / 全${entries.length}件`;
    else base = `📍 全${entries.length}件`;
    if (kigoFilter) base += ` [${kigoFilter}]`;
    return base;
  }, [searchQuery, timeFilter, isFiltering, matchedEntries.length, entries.length, kigoFilter]);

  const initialCenter: [number, number] = focusEntry ? [focusEntry.lat, focusEntry.lng] : [43.1957, 140.7835];
  const initialZoom = focusEntry ? 15 : 12;

  return (
    <div className={styles.root}>
      <header className={styles.header}>
        <button className={styles.back} onClick={() => go(from)}>← 戻る</button>
        <span className={styles.title}>🗺️ フィールドマップ</span>
      </header>

      <main className={styles.main}>
        {loadState === 'loading' && <div className={styles.loading}>読み込み中…</div>}

        {loadState === 'error' && (
          <div className={styles.errorBox}>
            <p className={styles.errorText}>{errorMessage}</p>
            <button className={styles.retryBtn} onClick={() => reload()}>再読み込み</button>
          </div>
        )}

        {loadState === 'ready' && (
          <>
            <FieldMapControls
              searchQuery={searchQuery}
              onSearchChange={setSearchQuery}
              kigoOptions={kigoOptions}
              kigoFilter={kigoFilter}
              onKigoChange={setKigoFilter}
              timeFilter={timeFilter}
              onTimeFilterChange={(k: TimeFilterKey) => setTimeFilter(k)}
              yearOptions={yearOptions}
              customDateStart={customDateStart}
              customDateEnd={customDateEnd}
              onCustomDateChange={setCustomDateRange}
              dimMode={dimMode}
              onDimModeChange={setDimMode}
              statusText={statusText}
            />

            <MapContainer center={initialCenter} zoom={initialZoom} className={styles.mapWrap}>
              <TileLayer
                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://maps.gsi.go.jp/development/ichiran.html">国土地理院</a>'
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              />
              <TileLayer
                url="https://cyberjapandata.gsi.go.jp/xyz/std/{z}/{x}/{y}.png"
                opacity={0.55}
                className={styles.gsiOverlay}
                maxZoom={18}
              />

              <FitFieldBounds matched={matchedEntries} skipFirst={!!focusEntry} />

              <MarkerClusterGroup chunkedLoading maxClusterRadius={50} spiderfyOnMaxZoom>
                {entries.map((entry) => (
                  <FieldMarker
                    key={entry.id}
                    entry={entry}
                    matched={matchedIds.has(entry.id)}
                    dimMode={dimMode}
                    shouldOpen={focusEntry?.id === entry.id}
                    onOpenDetail={openDetail}
                  />
                ))}
              </MarkerClusterGroup>
            </MapContainer>

            <BottomSheet
              snap={sheetSnap}
              onSnapChange={setSheetSnap}
              contentRef={listRef}
              onContentScroll={handleListScroll}
              peek={<p className={styles.sheetCount}>{matchedEntries.length}件の観察記録</p>}
            >
              {matchedEntries.length === 0 ? (
                <p className={styles.empty}>該当する観察記録はありません</p>
              ) : (
                <div key={`${searchQuery}::${kigoFilter}`} className={styles.grid}>
                  {matchedEntries.map((entry) => (
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
              )}
            </BottomSheet>
          </>
        )}
      </main>
    </div>
  );
}
