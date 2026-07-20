import { useEffect, useRef } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useZukanFieldStore } from '../store/zukanFieldStore';
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

function FitAllBounds({ entries }: { entries: FieldLogEntry[] }) {
  const map = useMap();
  useEffect(() => {
    if (entries.length === 0) return;
    const bounds = L.latLngBounds(entries.map((e) => [e.lat, e.lng] as [number, number]));
    map.fitBounds(bounds, { padding: [32, 32] });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries]);
  return null;
}

function FieldMarker({ entry, shouldOpen, onOpenDetail }: {
  entry: FieldLogEntry; shouldOpen: boolean; onOpenDetail: (entry: FieldLogEntry) => void;
}) {
  const markerRef = useRef<L.Marker | null>(null);

  useEffect(() => {
    if (shouldOpen) markerRef.current?.openPopup();
  }, [shouldOpen]);

  return (
    <Marker position={[entry.lat, entry.lng]} icon={fieldMarkerIcon} ref={markerRef}>
      <Popup>
        <div className={styles.popup}>
          {entry.photoUrl && (
            <img className={styles.popupPhoto} src={entry.photoUrl} alt={entry.foodName} />
          )}
          <p className={styles.popupName}>{entry.foodName || '無題'}</p>
          <p className={styles.popupMeta}>📍 {entry.place || '場所不明'} ・ {entry.date}</p>
          {entry.kigo && <p className={styles.popupTag}>{entry.kigo}</p>}
          <button className={styles.popupBtn} onClick={() => onOpenDetail(entry)}>詳細を見る</button>
        </div>
      </Popup>
    </Marker>
  );
}

export default function ZukanFieldMapScreen({ go, focusEntry, from }: Props) {
  const { entries, loadState, errorMessage, ensureLoaded, reload } = useZukanFieldStore();

  useEffect(() => { void ensureLoaded(); }, [ensureLoaded]);

  const openDetail = (entry: FieldLogEntry) => {
    go({ name: 'zukanFieldDetail', entry, from: { name: 'zukanFieldMap', focusEntry, from } });
  };

  const initialCenter: [number, number] = focusEntry ? [focusEntry.lat, focusEntry.lng] : [43.19, 140.78];
  const initialZoom = focusEntry ? 15 : 11;

  return (
    <div className={styles.root}>
      <header className={styles.header}>
        <button className={styles.back} onClick={() => go(from)}>← 戻る</button>
        <span className={styles.title}>🗺️ フィールドマップ</span>
        <button
          className={styles.listBtn}
          onClick={() => go({ name: 'zukanFieldList' })}
        >
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
          <MapContainer center={initialCenter} zoom={initialZoom} className={styles.mapWrap}>
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
            {!focusEntry && <FitAllBounds entries={entries} />}
            {entries.map((entry) => (
              <FieldMarker
                key={entry.id}
                entry={entry}
                shouldOpen={focusEntry?.id === entry.id}
                onOpenDetail={openDetail}
              />
            ))}
          </MapContainer>
        )}
      </main>
    </div>
  );
}
