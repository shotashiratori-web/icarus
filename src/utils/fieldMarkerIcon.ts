import L from 'leaflet';
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png';
import markerIcon from 'leaflet/dist/images/marker-icon.png';
import markerShadow from 'leaflet/dist/images/marker-shadow.png';

// Leafletの既定マーカー画像はVite等のバンドラでパス解決が壊れる既知の問題があるため、
// 明示的にインポートしたURLで上書きする（定番のドロップ型ピンをそのまま使うための標準的な回避策）
delete (L.Icon.Default.prototype as unknown as { _getIconUrl?: unknown })._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: markerIcon2x,
  iconUrl: markerIcon,
  shadowUrl: markerShadow,
});

export const fieldMarkerIcon = new L.Icon.Default();

// 検索・フィルターに一致したピンを強調するための赤色版（定番のドロップ型ピンと同じ形・サイズを維持）
const redPinSvg = `<svg width="25" height="41" viewBox="0 0 25 41" xmlns="http://www.w3.org/2000/svg">
  <path d="M12.5 0C5.6 0 0 5.6 0 12.5c0 9.4 12.5 28.5 12.5 28.5S25 21.9 25 12.5C25 5.6 19.4 0 12.5 0z" fill="#c0392b"/>
  <circle cx="12.5" cy="12.5" r="5.5" fill="#ffffff"/>
</svg>`;

export const fieldMarkerIconMatched = L.divIcon({
  html: redPinSvg,
  className: 'field-marker-icon-matched',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
});
