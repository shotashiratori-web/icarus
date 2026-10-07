// 日没・薄明（Field Navigation v1 PR4）。設計: icarus_field_navigation_v1_design.md §2 ④
// 日付と緯度経度から端末の中だけで計算する（ネット不要）。天文学上の時刻だけを出し、
// Icarus が「あと何分なら安全」とは判断しない（谷や森の中は日没前から暗い）。
// 計算は NOAA の太陽計算（Meeus の式。均時差・赤緯をその時刻で求め、日没の時刻で 2 回繰り返す）。精度は 1 分以内。
// 日本（UTC+9・夏時間なし）だけで使うので、日付と表示は日本時間に固定する

const RAD = Math.PI / 180;
const JST_MS = 9 * 3600000;

export const SUNSET_ALT = -0.833; // 日の入り: 太陽の上端が地平線（大気差・視半径を含む）
export const CIVIL_DUSK_ALT = -6; // 市民薄明の終わり

// その時刻（ms）の太陽の赤緯（度）と均時差（分）。NOAA Solar Calculator と同じ式
function solar(ms: number): { decl: number; eqTime: number } {
  const jd = ms / 86400000 + 2440587.5;
  const t = (jd - 2451545) / 36525; // ユリウス世紀
  const l0 = (280.46646 + t * (36000.76983 + t * 0.0003032)) % 360; // 平均黄経
  const m = 357.52911 + t * (35999.05029 - 0.0001537 * t); // 平均近点角
  const e = 0.016708634 - t * (0.000042037 + 0.0000001267 * t); // 離心率
  const c = Math.sin(RAD * m) * (1.914602 - t * (0.004817 + 0.000014 * t)) + Math.sin(RAD * 2 * m) * (0.019993 - 0.000101 * t) + Math.sin(RAD * 3 * m) * 0.000289;
  const omega = 125.04 - 1934.136 * t;
  const lambda = l0 + c - 0.00569 - 0.00478 * Math.sin(RAD * omega); // 視黄経
  const eps0 = 23 + (26 + (21.448 - t * (46.815 + t * (0.00059 - t * 0.001813))) / 60) / 60;
  const eps = eps0 + 0.00256 * Math.cos(RAD * omega); // 黄道傾斜（補正）
  const decl = Math.asin(Math.sin(RAD * eps) * Math.sin(RAD * lambda)) / RAD;
  const y = Math.tan((RAD * eps) / 2) ** 2;
  const eqTime = (4 / RAD) * (y * Math.sin(2 * RAD * l0) - 2 * e * Math.sin(RAD * m) + 4 * e * y * Math.sin(RAD * m) * Math.cos(2 * RAD * l0)
    - 0.5 * y * y * Math.sin(4 * RAD * l0) - 1.25 * e * e * Math.sin(2 * RAD * m));
  return { decl, eqTime };
}

// 日本時間のその日（YYYY-MM-DD）
export function jstDateKey(ms: number): string {
  return new Date(ms + JST_MS).toISOString().slice(0, 10);
}

// その日（日本時間）に太陽が高度 altDeg を下回る時刻（ms）。一日中その高度より上／下なら null
export function sunDownTime(dateKey: string, lat: number, lng: number, altDeg: number): number | null {
  const utcMidnight = Date.parse(`${dateKey}T00:00:00Z`); // 同じ日付の UTC 0 時（日本の日没は UTC でも同じ日付の朝〜昼）
  let ms = Date.parse(`${dateKey}T17:00:00+09:00`); // 最初の見当
  for (let k = 0; k < 3; k++) {
    const { decl, eqTime } = solar(ms);
    const cosH = (Math.sin(RAD * altDeg) - Math.sin(RAD * lat) * Math.sin(RAD * decl)) / (Math.cos(RAD * lat) * Math.cos(RAD * decl));
    if (!(cosH >= -1 && cosH <= 1)) return null; // 沈まない（白夜）・昇らない（極夜）
    const ha = Math.acos(cosH) / RAD;
    const minutesUtc = 720 - 4 * (lng - ha) - eqTime; // その日の UTC 0 時からの分（日没側）
    ms = utcMidnight + minutesUtc * 60000;
  }
  return ms;
}

// 太陽の高度（度）。テストで「求めた時刻に本当にその高度か」を確かめるのに使う
export function sunAltitudeDeg(ms: number, lat: number, lng: number): number {
  const { decl, eqTime } = solar(ms);
  const minutesUtc = ((ms % 86400000) + 86400000) % 86400000 / 60000;
  const trueSolar = minutesUtc + eqTime + 4 * lng; // 視太陽時（分）
  const ha = trueSolar / 4 - 180;
  return Math.asin(Math.sin(RAD * lat) * Math.sin(RAD * decl) + Math.cos(RAD * lat) * Math.cos(RAD * decl) * Math.cos(RAD * ha)) / RAD;
}

export type SunBasis = 'here' | 'area'; // 現在地で計算 / 表示中の山域の中心で計算（約）

export interface SunLines {
  sunset: string; // 例: 日没 17:08　あと2:14
  dusk: string | null; // 例: 薄明終了 17:35
}

const hm = (ms: number) => new Date(ms + JST_MS).toISOString().slice(11, 16);
function left(fromMs: number, toMs: number): string {
  const min = Math.floor((toMs - fromMs) / 60000);
  return `${Math.floor(min / 60)}:${String(min % 60).padStart(2, '0')}`;
}

// 地図の上に出す 2 行。山域の中心で計算した時は「約」と「（山域基準）」
export function sunLines(nowMs: number, lat: number, lng: number, basis: SunBasis): SunLines {
  const key = jstDateKey(nowMs);
  const approx = basis === 'area' ? '約' : '';
  const tag = basis === 'area' ? '（山域基準）' : '';
  const set = sunDownTime(key, lat, lng, SUNSET_ALT);
  const dusk = sunDownTime(key, lat, lng, CIVIL_DUSK_ALT);
  if (set === null) {
    // 一日中沈まない／昇らない（日本では起きないが、壊れないように）
    const up = sunAltitudeDeg(Date.parse(`${key}T12:00:00+09:00`), lat, lng) > SUNSET_ALT;
    return { sunset: up ? `今日は日が沈みません${tag}` : `今日は日が昇りません${tag}`, dusk: null };
  }
  const sunset = nowMs < set ? `日没 ${approx}${hm(set)}　あと${left(nowMs, set)}${tag}` : `日没 ${approx}${hm(set)} 済${tag}`;
  if (dusk === null) return { sunset, dusk: null };
  const duskLine = nowMs < set ? `薄明終了 ${approx}${hm(dusk)}`
    : nowMs < dusk ? `薄明終了 ${approx}${hm(dusk)}　あと${left(nowMs, dusk)}`
      : `薄明終了 ${approx}${hm(dusk)} 済`;
  return { sunset, dusk: duskLine };
}
