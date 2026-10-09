// 「ここへ行く」（Field Navigation v1 PR3）。設計: icarus_field_navigation_v1_design.md §2 ③
// 直線距離と方角だけ（道は探さない・標高差は v2）。端末の中だけで計算するのでオフラインで動く。
// 大事なのは「北西 320m」より、今自分が向いている方向から見てどちらへ行けばよいか（#109 の方位を使う）

export type NavKind = 'spot' | 'fieldlog' | 'point';
export interface NavTarget {
  kind: NavKind;
  name: string;
  lat: number;
  lng: number;
}

const R = 6371008.8; // 地球の平均半径（m）
const rad = (d: number) => (d * Math.PI) / 180;

// 2 点の直線距離（m、大円）
export function distanceM(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

// a から b への方位（真北から時計回り、0〜360）
export function bearingDeg(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const y = Math.sin(rad(b.lng - a.lng)) * Math.cos(rad(b.lat));
  const x = Math.cos(rad(a.lat)) * Math.sin(rad(b.lat)) - Math.sin(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.cos(rad(b.lng - a.lng));
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

// 向いている方向から見た目的地の向き（-180〜180、正 = 右）
export function relativeDeg(targetBearing: number, heading: number): number {
  const d = (((targetBearing - heading) % 360) + 540) % 360 - 180;
  return d === -180 ? 180 : d;
}

const ARROWS = ['↑', '↗', '→', '↘', '↓', '↙', '←', '↖'];
const RELATIVE = ['正面', '右前方', '右', '右後方', '後ろ', '左後方', '左', '左前方'];
const DIRS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
const sector = (deg: number) => ((Math.round(deg / 45) % 8) + 8) % 8;

// 向いている方向から見て: 例 { arrow: '↖', text: '左前方' }
export function relativeGuide(rel: number): { arrow: string; text: string } {
  const k = sector(rel);
  return { arrow: ARROWS[k], text: RELATIVE[k] };
}

// 方角だけ（向きが分からない時）: 例 { arrow: '↖', text: 'NW 305°' }。矢印は北が上の地図の上での向き
export function absoluteGuide(bearing: number): { arrow: string; text: string } {
  const k = sector(bearing);
  return { arrow: ARROWS[k], text: `${DIRS[k]} ${Math.round(bearing) % 360}°` };
}

// 例: 8m / 320m / 1.2km
export function formatDistance(m: number): string {
  if (m >= 1000) return `${(m / 1000).toFixed(m >= 10000 ? 0 : 1)}km`;
  if (m >= 100) return `${Math.round(m / 10) * 10}m`;
  return `${Math.round(m)}m`;
}

// 到着の近く: 目的地まで「GPS の精度 ＋ 10m」以内（自動では終わらせない。表示だけ）
export function nearArrival(distance: number, accuracyM: number | null | undefined): boolean {
  return distance <= (typeof accuracyM === 'number' && accuracyM > 0 ? accuracyM : 0) + 10;
}
