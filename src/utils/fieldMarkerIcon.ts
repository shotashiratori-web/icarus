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
