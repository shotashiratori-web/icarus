import { useEffect, useState } from 'react';
import { MapContainer, TileLayer, Marker } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import { fieldMarkerIcon } from '../utils/fieldMarkerIcon';
import { reverseGeocodeShortLabel } from '../utils/reverseGeocode';
import styles from './FieldGpsMiniMap.module.css';

type Props = { lat: number; lng: number };

// フィールドログ一括整理画面向けの軽量な静止地図。撮影場所を思い出すための最小限の
// 視覚情報だけを表示する。操作（ドラッグ・ズーム等）は無効化し、静止画のように扱う。
// 地図だけでは「余市のどの辺か」が一目で分からないため、短い地名（市町村+地区程度）を
// 逆ジオコーディングで取得し1行だけ添える。取得失敗時は地図だけを表示する
export default function FieldGpsMiniMap({ lat, lng }: Props) {
  const [placeLabel, setPlaceLabel] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setPlaceLabel(null);
    reverseGeocodeShortLabel(lat, lng).then((label) => {
      if (!cancelled) setPlaceLabel(label);
    });
    return () => {
      cancelled = true;
    };
  }, [lat, lng]);

  return (
    <div>
      {placeLabel && <p className={styles.placeLabel}>📍 {placeLabel} 周辺</p>}
      <div className={styles.wrap}>
        <MapContainer
          center={[lat, lng]}
          zoom={13}
          className={styles.map}
          zoomControl={false}
          dragging={false}
          scrollWheelZoom={false}
          doubleClickZoom={false}
          touchZoom={false}
          boxZoom={false}
          keyboard={false}
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          <Marker position={[lat, lng]} icon={fieldMarkerIcon} />
        </MapContainer>
      </div>
    </div>
  );
}
