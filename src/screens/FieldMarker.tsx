import { useEffect, useRef } from 'react';
import { Marker, Popup, Tooltip } from 'react-leaflet';
import type L from 'leaflet';
import { fieldMarkerIcon, fieldMarkerIconMatched } from '../utils/fieldMarkerIcon';
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
  compact?: boolean; // trueの場合、名前・日付・詳細ボタンのみの簡易ポップアップ（狭いミニマップ向け）
  highlighted?: boolean; // trueの場合、検索に一致したピンとして赤色で強調表示する
};

export default function FieldMarker({ entry, matched, dimMode, shouldOpen, onOpenDetail, compact = false, highlighted = false }: Props) {
  const markerRef = useRef<L.Marker | null>(null);

  useEffect(() => {
    if (shouldOpen) markerRef.current?.openPopup();
  }, [shouldOpen]);

  if (!dimMode && !matched) return null;

  return (
    <Marker
      position={[entry.lat, entry.lng]}
      icon={highlighted ? fieldMarkerIconMatched : fieldMarkerIcon}
      opacity={matched ? 1 : 0.3}
      zIndexOffset={matched ? 1000 : 0}
      ref={markerRef}
    >
      <Tooltip direction="top" offset={[0, -34]} opacity={0.9} className={styles.hoverTooltip}>
        {entry.foodName || '無題'}
      </Tooltip>
      <Popup maxWidth={220}>
        {compact ? (
          <div className={styles.popup}>
            <p className={styles.popupName}>{entry.foodName || '無題'}</p>
            {entry.date && <p className={styles.popupMeta}>{entry.date}</p>}
            <button className={styles.popupBtn} onClick={() => onOpenDetail(entry)}>詳細を見る</button>
          </div>
        ) : (
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
        )}
      </Popup>
    </Marker>
  );
}
