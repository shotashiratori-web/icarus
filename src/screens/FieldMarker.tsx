import { useEffect, useRef } from 'react';
import { Marker, Popup } from 'react-leaflet';
import type L from 'leaflet';
import { fieldMarkerIcon } from '../utils/fieldMarkerIcon';
import type { FieldLogEntry } from '../types/zukan';
import styles from './FieldMarker.module.css';

function buildDirectionsUrl(lat: number, lng: number): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
}

type Props = {
  entry: FieldLogEntry;
  matched: boolean;
  dimMode: boolean;
  shouldOpen: boolean;
  onOpenDetail: (entry: FieldLogEntry) => void;
};

export default function FieldMarker({ entry, matched, dimMode, shouldOpen, onOpenDetail }: Props) {
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
