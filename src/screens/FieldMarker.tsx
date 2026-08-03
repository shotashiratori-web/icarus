import { useEffect, useRef } from 'react';
import { Marker, Popup, Tooltip, useMap } from 'react-leaflet';
import type L from 'leaflet';
import { fieldMarkerIcon, fieldMarkerIconMatched } from '../utils/fieldMarkerIcon';
import type { FieldLogEntry } from '../types/zukan';
import styles from './FieldMarker.module.css';

function buildDirectionsUrl(lat: number, lng: number): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
}

// ポップアップの高さは中身（写真の有無等）で変わり、開く前には実測できないため、
// フル版ポップアップ・簡易版ポップアップそれぞれのおおよその高さを見込んで確保する
const ESTIMATED_POPUP_HEIGHT = 340;
const ESTIMATED_COMPACT_POPUP_HEIGHT = 110;

type Props = {
  entry: FieldLogEntry;
  matched: boolean;
  dimMode: boolean;
  shouldOpen: boolean;
  onOpenDetail: (entry: FieldLogEntry) => void;
  compact?: boolean; // trueの場合、名前・日付・詳細ボタンのみの簡易ポップアップ（狭いミニマップ向け）
  highlighted?: boolean; // trueの場合、検索に一致したピンとして赤色で強調表示する
  popupTopPadding?: number; // 地図に重ねた検索・絞り込みバーの実測高さ
  popupBottomFraction?: number; // 下部シート（BottomSheet）が占める高さの割合(0〜1)
};

export default function FieldMarker({
  entry, matched, dimMode, shouldOpen, onOpenDetail, compact = false, highlighted = false,
  popupTopPadding = 0, popupBottomFraction = 0,
}: Props) {
  const markerRef = useRef<L.Marker | null>(null);
  const map = useMap();

  useEffect(() => {
    if (shouldOpen) markerRef.current?.openPopup();
  }, [shouldOpen]);

  // クラスターアイコン側（ZukanFieldMapScreenのiconCreateFunction）で、
  // 束ねられた中に絞り込み条件に一致するピンが何件あるかを判定するために使う
  useEffect(() => {
    if (markerRef.current) (markerRef.current.options as L.MarkerOptions & { isMatched?: boolean }).isMatched = matched;
  }, [matched]);

  if (!dimMode && !matched) return null;

  // 検索バー等のオーバーレイ・下部シートを差し引いた「実際に使える高さ」。
  // ピンをどれだけパンさせても、狭い画面ではポップアップがこれより大きいと入り切らないため、
  // 入り切らない場合はLeaflet標準のスクロール可能ポップアップとして表示させる（maxHeight指定時の挙動）
  const mapSize = map.getSize();
  const availableHeight = mapSize.y - popupTopPadding - mapSize.y * popupBottomFraction - 40;
  const maxPopupHeight = Math.max(160, availableHeight);

  // ポップアップは既定でピンの上に開くため、ピンが画面上部（検索・絞り込みバーの裏）に近いと
  // ポップアップがそのバーの下に隠れてしまう。Leafletの自動パンに任せず、タップ時に明示的に
  // 地図をパンして、ピンの上に十分な表示スペースを確保してから開く
  const handleMarkerClick = () => {
    const size = map.getSize();
    const estimatedPopupHeight = compact ? ESTIMATED_COMPACT_POPUP_HEIGHT : ESTIMATED_POPUP_HEIGHT;
    // 余白は多めに確保する（オーバーレイの高さは計測タイミングによって数十px程度ずれることがあるため）
    const bottomClearance = size.y * popupBottomFraction + 40;
    const desiredScreenY = Math.min(
      popupTopPadding + estimatedPopupHeight + 50,
      size.y - bottomClearance,
    );
    const currentPoint = map.latLngToContainerPoint([entry.lat, entry.lng]);
    if (currentPoint.y >= desiredScreenY - 4) return; // 既に十分な表示スペースがあるので動かさない

    const verticalOffset = desiredScreenY - size.y / 2;
    const targetWorldPoint = map.project([entry.lat, entry.lng], map.getZoom()).subtract([0, verticalOffset]);
    const targetLatLng = map.unproject(targetWorldPoint, map.getZoom());
    map.panTo(targetLatLng, { animate: true });
  };

  return (
    <Marker
      position={[entry.lat, entry.lng]}
      icon={highlighted ? fieldMarkerIconMatched : fieldMarkerIcon}
      opacity={matched ? 1 : 0.3}
      zIndexOffset={matched ? 1000 : 0}
      ref={markerRef}
      eventHandlers={{ click: handleMarkerClick }}
    >
      <Tooltip direction="top" offset={[0, -34]} opacity={0.9} className={styles.hoverTooltip}>
        {entry.foodName || '無題'}
      </Tooltip>
      {/*
        位置決めはタップ時のhandleMarkerClickで明示的に行うため、Leaflet標準のautoPanは無効化する。
        併用すると、ポップアップが実際にDOMへ挿入された時点でLeaflet自身がもう一度別の計算で
        自動パンし、こちらの計算結果を横から書き換えてしまう（要調査で確認済みの実際の不具合）。
      */}
      <Popup maxWidth={220} maxHeight={maxPopupHeight} autoPan={false}>
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
