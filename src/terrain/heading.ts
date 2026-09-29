// 進行方向モード（地形探索）: iPhone を向けている方向を画面の上にして地図を回す。
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

const DIRS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'] as const;
const ARROWS = ['↑', '↗', '→', '↘', '↓', '↙', '←', '↖'];

// 例: 312° → '↖ NW 312°'
export function headingLabel(deg: number): string {
  const k = Math.round(deg / 45) % 8;
  return `${ARROWS[k]} ${DIRS[k]} ${Math.round(deg) % 360}°`;
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
