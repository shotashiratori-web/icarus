import { useEffect, useMemo } from 'react';
import { MapContainer, TileLayer } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import { useZukanFieldStore } from '../store/zukanFieldStore';
import { computeDateRange, lastYearSameLabel, type TimeFilterKey } from '../utils/fieldTimeFilter';
import { matchesFilter } from '../utils/fieldFilter';
import FieldMapControls from './FieldMapControls';
import FieldMarker from './FieldMarker';
import FitFieldBounds from './FitFieldBounds';
import type { FieldLogEntry } from '../types/zukan';
import type { Screen } from '../App';
import styles from './ZukanFieldMapScreen.module.css';

type Props = { go: (s: Screen) => void; focusEntry?: FieldLogEntry; from: Screen };

export default function ZukanFieldMapScreen({ go, focusEntry, from }: Props) {
  const {
    entries, loadState, errorMessage, ensureLoaded, reload,
    searchQuery, kigoFilter, setSearchQuery, setKigoFilter,
    timeFilter, setTimeFilter, customDateStart, customDateEnd, setCustomDateRange,
    dimMode, setDimMode,
  } = useZukanFieldStore();

  useEffect(() => { void ensureLoaded(); }, [ensureLoaded]);

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
        <button className={styles.listBtn} onClick={() => go({ name: 'zukanFieldList' })}>
          📋 一覧で見る
        </button>
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
            </MapContainer>
          </>
        )}
      </main>
    </div>
  );
}
