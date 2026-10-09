// 向いている方向（地形探索）: iPhone の方位センサーで「向いている方向」を読む。使い道は 2 つ（Field Navigation v1 PR2）:
//   - 扇形: 北が上の地図のまま、現在地に視野 約 60° の扇形（通常）
//   - 向いている方向を上に: 地図そのものを回す（必要な時だけ）
// 「進んでいる方向」（GPS の移動）とは別物。以下、地図の回転について:
// 地図の回転は CSS（回転プラグイン leaflet-rotate は GPL-3.0 のため使わない）。回転中は地図を自分の位置に固定し、
// ドラッグは使わず、ズームは画面中央（=自分）を軸にする。タップ位置は回転を戻してから地図の座標にする

// 磁気偏角（東が正）。コンパスは磁北、地図は真北なので足して真北にする。
// 余市・仁木・赤井川付近は西偏 約 9.5°（国土地理院 磁気図 2020.0 の値の目安）。範囲が広がったらエリアごとに持つ
export const DECLINATION_DEG = -9.5;

// DeviceOrientationEvent → 真北からの時計回りの向き（度）。iOS は webkitCompassHeading（磁北基準）、ほかは絶対 alpha（反時計回り）
export function headingFromEvent(
  e: { alpha: number | null; absolute?: boolean; webkitCompassHeading?: number },
  screenAngle: number,
  declinationDeg = DECLINATION_DEG,
): number | null {
  let h: number | null = null;
  if (typeof e.webkitCompassHeading === 'number' && !Number.isNaN(e.webkitCompassHeading)) h = e.webkitCompassHeading;
  else if (e.absolute && typeof e.alpha === 'number') h = 360 - e.alpha;
  if (h === null) return null;
  return (((h + screenAngle + declinationDeg) % 360) + 360) % 360; // 画面を横にした時は画面の上の向きへ。磁北 → 真北
}

// 角度のなめらか化（0/360 をまたいでも正しく）。k: 新しい値の重み
export function smoothAngle(prev: number | null, next: number, k = 0.25): number {
  if (prev === null) return next;
  const d = ((next - prev + 540) % 360) - 180;
  return (((prev + d * k) % 360) + 360) % 360;
}

// iOS の webkitCompassAccuracy（度。-1 = 使えない）。大きい・負なら「方向が不安定」（金属・車内・ケースの磁石など）
export const COMPASS_UNSTABLE_DEG = 25;
export function compassUnstable(accuracy: number | null | undefined): boolean {
  if (typeof accuracy !== 'number' || Number.isNaN(accuracy)) return false; // 値の無い端末は判定しない
  return accuracy < 0 || accuracy > COMPASS_UNSTABLE_DEG;
}

const DIRS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'] as const;
const ARROWS = ['↑', '↗', '→', '↘', '↓', '↙', '←', '↖'];

// 例: 312° → '↖ NW 312°'
export function headingLabel(deg: number): string {
  const k = Math.round(deg / 45) % 8;
  return `${ARROWS[k]} ${DIRS[k]} ${Math.round(deg) % 360}°`;
}

// 扇形の横に出す短い表示。例: 'NW 310°'、不安定なら 'NW 310°（不安定）'
export function coneLabel(deg: number, unstable = false): string {
  const k = Math.round(deg / 45) % 8;
  return `${DIRS[k]} ${Math.round(deg) % 360}°${unstable ? '（不安定）' : ''}`;
}

// 画面の点 → 回転前の地図コンテナの点。地図（一辺 size の正方形）は中心が画面の anchor に来るよう置き、rotate(-heading) している
export function screenToMapPoint(p: { x: number; y: number }, anchor: { x: number; y: number }, size: number, headingDeg: number): { x: number; y: number } {
  const t = (headingDeg * Math.PI) / 180;
  const dx = p.x - anchor.x;
  const dy = p.y - anchor.y;
  return { x: size / 2 + Math.cos(t) * dx - Math.sin(t) * dy, y: size / 2 + Math.sin(t) * dx + Math.cos(t) * dy };
}

// 回転しても画面の四隅が空かない大きさ（anchor から一番遠い角までの距離 × 2）
export function rotorSize(w: number, h: number, anchor: { x: number; y: number }): number {
  const far = Math.max(Math.hypot(anchor.x, anchor.y), Math.hypot(w - anchor.x, anchor.y), Math.hypot(anchor.x, h - anchor.y), Math.hypot(w - anchor.x, h - anchor.y));
  return Math.ceil(far * 2) + 2;
}

type OrientationCtor = { requestPermission?: () => Promise<'granted' | 'denied'> };

// iOS は利用者の操作の中で許可を求める必要がある（押した時だけ呼ぶ）
export async function requestOrientationPermission(): Promise<'granted' | 'denied' | 'unsupported'> {
  if (typeof window === 'undefined' || typeof (window as unknown as { DeviceOrientationEvent?: unknown }).DeviceOrientationEvent === 'undefined') return 'unsupported';
  const C = (window as unknown as { DeviceOrientationEvent: OrientationCtor }).DeviceOrientationEvent;
  if (typeof C.requestPermission !== 'function') return 'granted';
  try {
    return (await C.requestPermission()) === 'granted' ? 'granted' : 'denied';
  } catch {
    return 'denied';
  }
}
