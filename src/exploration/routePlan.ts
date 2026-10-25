import { openDB, type IDBPDatabase } from 'idb';

// 歩く線の予定（ルート予定）v1（icarus/docs/architecture/icarus_route_plan_v1_design.md）。
// 道の経路探索はしない（山には道が無い）。人が地図に引いた線を、距離・登り下り・傾斜・時間の目安で見る。
// 端末だけに保存（D1 へ送らない）。標高は引いた時（電波のある所）に取って一緒に保存する → 圏外でも見られる

export type LatLng = { lat: number; lng: number };
export type WalkMode = 'forest' | 'road';
export const WALK_MODES: { id: WalkMode; label: string; kmh: number }[] = [
  { id: 'forest', label: '山林探索（水平 2km/時）', kmh: 2 }, // 初期値。林内で速すぎる見積もりの方が危ない
  { id: 'road', label: '林道・道中心（水平 4km/時）', kmh: 4 },
];
export const CLIMB_M_PER_HOUR = 300; // 登り 300m ごとに 1 時間
export const SAMPLE_STEP_M = 10; // 標高を取る間隔

export interface RoutePlan {
  id: string;
  name: string;
  plannedDate: string | null; // YYYY-MM-DD（任意）
  purpose: string; // 目的（任意。例「シモフリシメジ」「1947 樹冠確認」）
  mode: WalkMode;
  points: LatLng[]; // 人が置いた点（順番どおり）
  elevations: number[] | null; // 線に沿って SAMPLE_STEP_M ごとの標高（m）。取れなかったら null
  createdAt: string;
  visible: boolean;
}

const R = 6371008.8;
export function distM(a: LatLng, b: LatLng): number {
  const p1 = (a.lat * Math.PI) / 180, p2 = (b.lat * Math.PI) / 180;
  const dp = p2 - p1, dl = ((b.lng - a.lng) * Math.PI) / 180;
  const h = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}
export function lengthM(points: LatLng[]): number {
  let s = 0;
  for (let i = 1; i < points.length; i++) s += distM(points[i - 1], points[i]);
  return s;
}
// 線に沿って step m ごとの点（始点と終点を含む）。標高を取る位置
export function densify(points: LatLng[], step = SAMPLE_STEP_M): LatLng[] {
  if (points.length === 0) return [];
  const out: LatLng[] = [points[0]];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i], d = distM(a, b), n = Math.max(1, Math.ceil(d / step));
    for (let k = 1; k <= n; k++) out.push({ lat: a.lat + ((b.lat - a.lat) * k) / n, lng: a.lng + ((b.lng - a.lng) * k) / n });
  }
  return out;
}

export interface RouteStats { lengthM: number; ascentM: number | null; descentM: number | null; maxSlopeDeg: number | null; hours: number | null }
// 登り下りは 10m ごとの標高の差の合計（2m 未満の上下は数えない＝標高データの細かな揺れを足さない）。
// 傾斜は 30m の区間ごとの平均の一番急な所。時間 = 水平距離 / 速さ ＋ 登り / 300m
export function routeStats(points: LatLng[], elevations: number[] | null, mode: WalkMode): RouteStats {
  const len = lengthM(points);
  const kmh = WALK_MODES.find((m) => m.id === mode)?.kmh ?? 2;
  if (!elevations || elevations.length < 2) return { lengthM: len, ascentM: null, descentM: null, maxSlopeDeg: null, hours: null };
  let up = 0, down = 0, ref = elevations[0];
  for (const h of elevations) {
    if (h - ref >= 2) { up += h - ref; ref = h; } else if (ref - h >= 2) { down += ref - h; ref = h; }
  }
  const step = len / (elevations.length - 1), w = Math.max(1, Math.round(30 / Math.max(step, 1)));
  let maxSlope = 0;
  for (let i = 0; i + w < elevations.length; i++) maxSlope = Math.max(maxSlope, (Math.atan(Math.abs(elevations[i + w] - elevations[i]) / (w * step)) * 180) / Math.PI);
  return { lengthM: len, ascentM: Math.round(up), descentM: Math.round(down), maxSlopeDeg: Math.round(maxSlope), hours: len / 1000 / kmh + up / CLIMB_M_PER_HOUR };
}
export function hoursText(h: number): string {
  const m = Math.round(h * 60);
  return m < 60 ? `約${m}分` : `約${Math.floor(m / 60)}時間${m % 60 ? `${m % 60}分` : ''}`;
}

const esc = (s: string) => s.replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c] as string);
// GPX の書き出し（YAMAP 等で読める route）。標高があれば点にも付ける
export function routeToGpx(r: RoutePlan): string {
  const desc = [r.plannedDate ? `予定日 ${r.plannedDate}` : '', r.purpose ? `目的 ${r.purpose}` : ''].filter(Boolean).join('・');
  const pts = r.points.map((p) => `<rtept lat="${p.lat.toFixed(6)}" lon="${p.lng.toFixed(6)}"></rtept>`).join('\n    ');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="Icarus ルート予定" xmlns="http://www.topografix.com/GPX/1/1">\n  <metadata><name>${esc(r.name)}</name>${desc ? `<desc>${esc(desc)}</desc>` : ''}</metadata>\n  <rte><name>${esc(r.name)}</name>\n    ${pts}\n  </rte>\n</gpx>\n`;
}

const DB_NAME = 'icarus-route-plans';
const STORE = 'routes';
let dbPromise: Promise<IDBPDatabase> | null = null;
function db(): Promise<IDBPDatabase> {
  if (!dbPromise) dbPromise = openDB(DB_NAME, 1, { upgrade(d) { if (!d.objectStoreNames.contains(STORE)) d.createObjectStore(STORE, { keyPath: 'id' }); } });
  return dbPromise;
}
export async function closeRouteStoreForTest(): Promise<void> { if (dbPromise) (await dbPromise).close(); dbPromise = null; }
export async function saveRoute(r: RoutePlan): Promise<void> { await (await db()).put(STORE, r); }
export async function listRoutes(): Promise<RoutePlan[]> {
  return ((await (await db()).getAll(STORE)) as RoutePlan[]).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
export async function setRouteVisible(id: string, visible: boolean): Promise<void> {
  const d = await db(); const r = (await d.get(STORE, id)) as RoutePlan | undefined;
  if (r) await d.put(STORE, { ...r, visible });
}
export async function deleteRoute(id: string): Promise<void> { await (await db()).delete(STORE, id); }
