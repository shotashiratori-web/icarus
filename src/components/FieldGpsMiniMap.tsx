import { MapContainer, TileLayer, Marker } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import { fieldMarkerIcon } from '../utils/fieldMarkerIcon';
import styles from './FieldGpsMiniMap.module.css';

type Props = { lat: number; lng: number };

// フィールドログ一括整理画面向けの軽量な静止地図。撮影場所を思い出すための最小限の
// 視覚情報だけを表示する。操作（ドラッグ・ズーム等）は無効化し、静止画のように扱う
export default function FieldGpsMiniMap({ lat, lng }: Props) {
  return (
    <div className={styles.wrap}>
      <MapContainer
        center={[lat, lng]}
        zoom={15}
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
  );
}
