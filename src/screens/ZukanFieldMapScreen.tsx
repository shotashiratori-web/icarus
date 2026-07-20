import { useEffect, useMemo, useRef } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useZukanFieldStore } from '../store/zukanFieldStore';
import { computeDateRange, isDateInRange, lastYearSameLabel, type TimeFilterKey } from '../utils/fieldTimeFilter';
import FieldMapControls from './FieldMapControls';
import type { FieldLogEntry } from '../types/zukan';
import type { Screen } from '../App';
import styles from './ZukanFieldMapScreen.module.css';

type Props = { go: (s: Screen) => void; focusEntry?: FieldLogEntry; from: Screen };

// 既定のLeafletマーカー画像はバンドラでパス解決が壊れやすいため、絵文字ベースのDivIconで代替する
const fieldMarkerIcon = L.divIcon({
  html: `<div class="${styles.markerEmoji}">🌱</div>`,
  className: styles.markerIconWrap,
  iconSize: [32, 32],
  iconAnchor: [16, 28],
  popupAnchor: [0, -28],
});

function buildDirectionsUrl(lat: number, lng: number): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
}

function matchesFilter(
  entry: FieldLogEntry,
  dateRange: ReturnType<typeof computeDateRange>,
  kigoFilter: string,
  searchQuery: string,
): boolean {
  if (!isDateInRange(entry.date, dateRange)) return false;
  if (kigoFilter && entry.kigo !== kigoFilter) return false;
  const q = searchQuery.trim().toLowerCase();
  if (q) {
    const hay = `${entry.foodName}${entry.place}${entry.memo}${entry.kigo}${entry.date}`.toLowerCase();
    if (!hay.includes(q)) return false;
  }
  return true;
}

function FitFilteredBounds({ matched, skipFirst }: { matched: FieldLogEntry[]; skipFirst: boolean }) {
  const map = useMap();
  const isFirstRun = useRef(true);

  useEffect(() => {
    if (isFirstRun.current) {
      isFirstRun.current = false;
      if (skipFirst) return;
    }
    if (matched.length >= 2) {
      const bounds = L.latLngBounds(matched.map((e) => [e.lat, e.lng] as [number, number]));
      map.fitBounds(bounds, { padding: [50, 60], maxZoom: 15 });
    } else if (matched.length === 1) {
      map.setView([matched[0].lat, matched[0].lng], 14);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matched]);

  return null;
}

function FieldMarker({ entry, matched, dimMode, shouldOpen, onOpenDetail }: {
  entry: FieldLogEntry; matched: boolean; dimMode: boolean; shouldOpen: boolean; onOpenDetail: (entry: FieldLogEntry) => void;
}) {
  const markerRef = useRef<L.Marker | null>(null);

  useEffect(() => {
    if (shouldOpen) markerRef.current?.openPopup();
  }, [shouldOpen]);

  if (!dimMode && !matched) return null;

  return (
    <Marker
      position={[entry.lat, entry.lng]}
      icon={fieldMarkerIcon}
      opacity={matched ? 1 : 0.3}
      zIndexOffset={matched ? 1000 : 0}
      ref={markerRef}
    >
      <Popup maxWidth={220}>
        <div className={styles.popup}>
          {entry.photoUrl && (
            <img className={styles.popupPhoto} src={entry.photoUrl} alt={entry.foodName} />
          )}
          <p className={styles.popupName}>{entry.foodName || '無題'}</p>
          {entry.place && <p className={styles.popupPlace}>📍 {entry.place}</p>}
          {entry.date && <p className={styles.popupMeta}>{entry.date}</p>}
          {entry.elevation !== null && <p className={styles.popupElev}>標高 {entry.elevation}m</p>}
          {entry.kigo && <p className={styles.popupTag}>{entry.kigo}</p>}

          <div className={styles.popupActions}>
            {entry.photoUrl && (
              <a className={styles.popupAct} href={entry.photoUrl} target="_blank" rel="noreferrer" title="写真を見る">📷</a>
            )}
            <a className={styles.popupAct} href={buildDirectionsUrl(entry.lat, entry.lng)} target="_blank" rel="noreferrer" title="経路案内">🧭</a>
            {entry.notionUrl && (
              <a className={styles.popupAct} href={entry.notionUrl} target="_blank" rel="noreferrer" title="Notionで開く">📖</a>
            )}
          </div>
          <button className={styles.popupBtn} onClick={() => onOpenDetail(entry)}>詳細を見る</button>
        </div>
      </Popup>
    </Marker>
  );
}

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

              <FitFilteredBounds matched={matchedEntries} skipFirst={!!focusEntry} />

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
