// 前回の画面の復元（Field Navigation v1 PR1）。設計: icarus_field_navigation_v1_design.md §2 ①
// - 表示の設定（層・条件・表示の切り替え）は全山域で 1 つ（山域を替えても条件を引き継ぐ今の動きと同じ）
// - 地図の中心・ズームは山域ごと
// - 端末（localStorage）だけ。読めない・壊れている・形が違う値は捨てて、その項目は初期値のまま
// - 復元しないもの: 現在地の追従・GPS の監視・向いている方向／地図の回転・案内・開いていたシート（ここに入れない）

export const VIEW_KEY = 'icarus:terrain-view-v1';
export const cameraKey = (areaId: string) => `icarus:terrain-camera-v1:${areaId}`;

export interface Camera {
  lat: number;
  lng: number;
  zoom: number;
}

// 既定値と同じ形（キー・型・配列）の値だけを通す。null が既定の項目は、null・文字列・有限の数（例: 沢からの距離の条件）
export function sameShape<T>(def: T, value: unknown): value is T {
  if (def === null) return value === null || typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value));
  if (Array.isArray(def)) {
    if (!Array.isArray(value)) return false;
    const sample = def[0];
    return sample === undefined
      ? value.every((v) => ['string', 'number', 'boolean'].includes(typeof v))
      : value.every((v) => sameShape(sample, v));
  }
  if (typeof def === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const keys = Object.keys(def as object);
    return keys.every((k) => k in (value as object) && sameShape((def as Record<string, unknown>)[k], (value as Record<string, unknown>)[k]));
  }
  return typeof value === typeof def && !(typeof value === 'number' && !Number.isFinite(value));
}

function read(key: string): unknown {
  try {
    const s = localStorage.getItem(key);
    return s ? JSON.parse(s) : null;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* 覚えられなくても使える */
  }
}

// 保存してある表示の設定のうち、既定値と同じ形の項目だけを返す（allowed があればその値の中だけ）
export function loadView<T extends Record<string, unknown>>(defaults: T, allowed: Partial<Record<keyof T, readonly unknown[]>> = {}): Partial<T> {
  const raw = read(VIEW_KEY);
  if (!raw || typeof raw !== 'object' || (raw as { v?: unknown }).v !== 1) return {};
  const out: Partial<T> = {};
  for (const k of Object.keys(defaults) as (keyof T)[]) {
    const v = (raw as Record<string, unknown>)[k as string];
    if (v === undefined || !sameShape(defaults[k], v)) continue;
    const list = allowed[k];
    if (list && !(Array.isArray(v) ? v.every((x) => list.includes(x)) : list.includes(v))) continue;
    out[k] = v as T[keyof T];
  }
  return out;
}

export function saveView(view: Record<string, unknown>): void {
  write(VIEW_KEY, { v: 1, ...view });
}

// 山域の中心・ズーム。山域の範囲（少し広めに）の中にあり、ズームが妥当な時だけ
export function loadCamera(areaId: string, bounds: { south: number; north: number; west: number; east: number }): Camera | null {
  const raw = read(cameraKey(areaId)) as Partial<Camera & { v: number }> | null;
  if (!raw || raw.v !== 1) return null;
  const { lat, lng, zoom } = raw;
  if (![lat, lng, zoom].every((n) => typeof n === 'number' && Number.isFinite(n))) return null;
  const m = 0.02; // 範囲の端を少し越えた所までは許す（maxBounds の粘りと同じくらい）
  if (lat! < bounds.south - m || lat! > bounds.north + m || lng! < bounds.west - m || lng! > bounds.east + m) return null;
  if (zoom! < 8 || zoom! > 20) return null;
  return { lat: lat!, lng: lng!, zoom: zoom! };
}

export function saveCamera(areaId: string, c: Camera): void {
  write(cameraKey(areaId), { v: 1, lat: Math.round(c.lat * 1e6) / 1e6, lng: Math.round(c.lng * 1e6) / 1e6, zoom: Math.round(c.zoom * 100) / 100 });
}
