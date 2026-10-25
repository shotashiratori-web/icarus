import { openDB, type IDBPDatabase } from 'idb';

// 歩く線の予定（ルート予定）v1（icarus/docs/architecture/icarus_route_plan_v1_design.md）。
// 道の経路探索はしない（山には道が無い）。人が地図に引いた線を、距離・登り下り・傾斜・時間の目安で見る。
// 端末だけに保存（D1 へ送らない）。標高は引いた時（電波のある所）に取って一緒に保存する → 圏外でも見られる

export type LatLng = { lat: number; lng: number };
// v2（icarus_route_plan_v2_design.md）: 点の 3 種類。経由点 = 線を曲げるためだけ（時間を足さない）／
// 立ち寄り地点 = 自分で打つ（名前・メモ・滞在時間）／既存候補 = 予測地点の「？」から（＋組の名前）。v1 の点（kind 無し）は経由点
export type PointKind = 'via' | 'stop' | 'candidate';
export interface RoutePoint extends LatLng { kind?: PointKind; name?: string; memo?: string; stayMin?: number; setTitle?: string }
export const DEFAULT_STAY_MIN = 20; // 0 分も可（沢を渡る・尾根に上がる・引き返し判断地点など）
export const kindOf = (p: RoutePoint): PointKind => p.kind ?? 'via';
export const isStop = (p: RoutePoint) => kindOf(p) !== 'via';
export const stayTotalMin = (points: RoutePoint[]) => points.reduce((s, p) => s + (isStop(p) ? Math.max(0, p.stayMin ?? 0) : 0), 0);
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
  points: RoutePoint[]; // 人が置いた点（順番どおり）
  elevations: number[] | null; // 線に沿って SAMPLE_STEP_M ごとの標高（m）。取れなかったら null
  createdAt: string;
  visible: boolean;
  startTime?: string | null; // HH:MM（v2）
  returnTime?: string | null; // HH:MM を手で直した時だけ（無ければ 開始＋所要時間）
  // サーバーにある計画（v2）。無ければこの端末だけ（v1・試しに引いたルート）
  shared?: { createdByName: string; canEdit: boolean; updatedAt: string | null } | null;
  pendingUpload?: boolean; // サーバーに送る途中（圏外で保存した等）。電波が戻ったら送る
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

// ---- v2: 所要時間・時刻・日没 ----
export const hm = (min: number) => `${Math.floor(min / 60) % 24}:${String(Math.round(min) % 60).padStart(2, '0')}`;
export const parseHm = (s: string | null | undefined): number | null => {
  const m = s?.match(/^(\d{1,2}):(\d{2})$/); return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};
export interface PlanSummary {
  stats: RouteStats;
  stayMin: number;
  totalHours: number | null; // 歩く時間＋滞在時間
  startMin: number | null; returnMin: number | null; returnAuto: boolean;
  sunsetMin: number | null; lateForSunset: boolean;
}
// sunsetOf(dateKey, lat, lng) は日没の時刻（ms）を返す（sun.ts の sunDownTime を渡す）
export function planSummary(r: Pick<RoutePlan, 'points' | 'elevations' | 'mode' | 'plannedDate' | 'startTime' | 'returnTime'>, sunsetOf?: (dateKey: string, lat: number, lng: number) => number | null): PlanSummary {
  const stats = routeStats(r.points, r.elevations, r.mode);
  const stayMin = stayTotalMin(r.points);
  const walkH = stats.hours ?? (stats.lengthM / 1000 / (WALK_MODES.find((m) => m.id === r.mode)?.kmh ?? 2)); // 標高が無ければ水平だけ
  const totalHours = r.points.length >= 2 ? walkH + stayMin / 60 : null;
  const startMin = parseHm(r.startTime);
  const manual = parseHm(r.returnTime);
  const returnMin = manual ?? (startMin !== null && totalHours !== null ? startMin + Math.round(totalHours * 60) : null);
  let sunsetMin: number | null = null;
  if (sunsetOf && r.plannedDate && r.points.length) {
    const ms = sunsetOf(r.plannedDate, r.points[0].lat, r.points[0].lng);
    if (ms !== null) { const d = new Date(ms + 9 * 3600_000); sunsetMin = d.getUTCHours() * 60 + d.getUTCMinutes(); }
  }
  return { stats, stayMin, totalHours, startMin, returnMin, returnAuto: manual === null, sunsetMin, lateForSunset: returnMin !== null && sunsetMin !== null && returnMin > sunsetMin };
}
// 立ち寄る順の 1 行: S → 霜M1 → 沢を渡る → G（経由点は出さない。始点・終点は S・G）
export function stopsLine(points: RoutePoint[]): string {
  if (points.length < 2) return '';
  const mid = points.slice(1, -1).filter(isStop).map((p) => p.name || '地点');
  const end = (p: RoutePoint, tag: string) => (isStop(p) && p.name ? `${tag} ${p.name}` : tag);
  return [end(points[0], 'S'), ...mid, end(points[points.length - 1], 'G')].join(' → ');
}

// サーバーの一覧を端末に保存し直す（圏外でも出すため）。表示する／しないは端末の値を残す。
// サーバーから消えた（アーカイブされた）共有の計画は端末からも外す。端末だけのルート・送る途中のものは触らない
export interface ServerPlan {
  id: string; title: string; plannedDate: string | null; purpose: string; walkMode: WalkMode; startTime: string | null; returnTime: string | null;
  points: RoutePoint[]; elevations: number[] | null; createdByName: string; createdAt: string; updatedAt: string | null; canEdit: boolean;
}
export function fromServer(s: ServerPlan, visible = true): RoutePlan {
  return { id: s.id, name: s.title, plannedDate: s.plannedDate, purpose: s.purpose, mode: s.walkMode, startTime: s.startTime, returnTime: s.returnTime,
    points: s.points, elevations: s.elevations, createdAt: s.createdAt, visible, shared: { createdByName: s.createdByName, canEdit: s.canEdit, updatedAt: s.updatedAt }, pendingUpload: false };
}
export function toServerBody(r: RoutePlan) {
  return { title: r.name, plannedDate: r.plannedDate, purpose: r.purpose, walkMode: r.mode, startTime: r.startTime ?? null, returnTime: r.returnTime ?? null,
    points: r.points.map((p) => (isStop(p) ? { lat: p.lat, lng: p.lng, kind: kindOf(p), name: p.name || '地点', ...(p.memo ? { memo: p.memo } : {}), stayMin: Math.max(0, Math.round(p.stayMin ?? 0)), ...(p.setTitle ? { setTitle: p.setTitle } : {}) } : { lat: p.lat, lng: p.lng, kind: 'via' as const })),
    elevations: r.elevations };
}
export async function mergeServerRoutes(items: ServerPlan[]): Promise<void> {
  const d = await db();
  const all = (await d.getAll(STORE)) as RoutePlan[];
  const byId = new Map(all.map((r) => [r.id, r]));
  const ids = new Set(items.map((i) => i.id));
  for (const r of all) if (r.shared && !r.pendingUpload && !ids.has(r.id)) await d.delete(STORE, r.id);
  for (const i of items) {
    const prev = byId.get(i.id);
    if (prev?.pendingUpload) continue; // 端末で直してまだ送っていない方を残す
    await d.put(STORE, fromServer(i, prev?.visible ?? true));
  }
}
