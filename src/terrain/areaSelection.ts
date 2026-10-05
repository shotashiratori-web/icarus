import type { SavedArea } from './areaStore';
import { insideBounds } from './initialView';
import type { TerrainAreaSummary, TerrainBounds } from './types';

// 複数エリア（山域）の選び方。全体図（北海道のフィールド入口）と地図の行き来で使う純粋関数。
// 設計: icarus/docs/architecture/icarus_terrain_multi_area_ui_design.md §2-4・§2-6

export const LAST_AREA_KEY = 'icarus:terrain-last-area';
export const AREAS_INDEX_CACHE_KEY = 'icarus:terrain-areas-index';

export type AreaStatus =
  | 'saved' // 保存済み・最新（または一覧が取れず最新か分からない）
  | 'update' // 保存済み・新しい版あり
  | 'unsaved' // 未保存・電波あり（保存して開ける）
  | 'unavailable'; // 未保存・電波なし（開けない）

export interface AreaEntry {
  areaId: string;
  name: string;
  bounds: TerrainBounds;
  remote: TerrainAreaSummary | null; // 公開中の版（一覧が取れた時）
  saved: SavedArea | null; // 端末に保存した版
  totalBytes: number | null; // 公開中の版の容量（一覧の値。無ければ保存済みの容量）
}

// 公開中の一覧・保存済み・前回の一覧（オフラインで未保存の枠を出すため）を 1 つにまとめる。
// 並びは北から南（同じなら西から）。山域が増えても地図と同じ順で読める
export function mergeAreas(remote: TerrainAreaSummary[] | null, saved: SavedArea[], cachedIndex: TerrainAreaSummary[]): AreaEntry[] {
  const byId = new Map<string, AreaEntry>();
  const listed = remote ?? cachedIndex;
  for (const r of listed) {
    byId.set(r.areaId, { areaId: r.areaId, name: r.name, bounds: r.bounds, remote: remote ? r : null, saved: null, totalBytes: r.totalBytes ?? null });
  }
  for (const s of saved) {
    const e = byId.get(s.areaId);
    if (e) e.saved = s;
    else byId.set(s.areaId, { areaId: s.areaId, name: s.name, bounds: s.manifest.bounds, remote: null, saved: s, totalBytes: s.bytes });
  }
  return [...byId.values()].sort((a, b) => b.bounds.north - a.bounds.north || a.bounds.west - b.bounds.west);
}

export function areaStatus(e: AreaEntry, online: boolean): AreaStatus {
  if (e.saved) return e.remote && e.remote.version !== e.saved.version ? 'update' : 'saved';
  return online && e.remote ? 'unsaved' : 'unavailable';
}

// 開ける形: 保存済みは端末から、未保存は電波があればネットから（保存しない）
export function canOpen(e: AreaEntry, online: boolean): 'saved' | 'network' | null {
  if (e.saved) return 'saved';
  return online && e.remote ? 'network' : null;
}

// 現在地を含む山域（保存済みを先に）。重なり（余市とニセコの北緯 43.02〜43.03）では保存済み → 北の順
export function areasAt(entries: AreaEntry[], lat: number, lng: number): AreaEntry[] {
  return entries.filter((e) => insideBounds(e.bounds, lat, lng)).sort((a, b) => Number(!!b.saved) - Number(!!a.saved));
}

export type InitialChoice = { kind: 'open'; areaId: string; from: 'saved' | 'network' } | { kind: 'overview' };

// 地図を開いた時にどの山域を出すか（§2-4）。自動で開くのは保存済みの山域だけ（未保存の山域を黙って取りに行かない）
// - 前回の山域が保存済みならそれ
// - 保存済みがあれば、現在地を含むもの → 無ければ保存済みの最初（北から）。余市だけ保存している人は今までどおり余市が開く
// - 保存済みが無ければ全体図（前回「保存せずに見る」で開いた山域も、次は全体図から選び直す）
export function chooseInitialArea(entries: AreaEntry[], lastAreaId: string | null, pos: { lat: number; lng: number } | null): InitialChoice {
  const last = lastAreaId ? entries.find((e) => e.areaId === lastAreaId && e.saved) : undefined;
  if (last) return { kind: 'open', areaId: last.areaId, from: 'saved' };
  const saved = entries.filter((e) => e.saved);
  if (saved.length) {
    const here = pos ? saved.find((e) => insideBounds(e.bounds, pos.lat, pos.lng)) : undefined;
    return { kind: 'open', areaId: (here ?? saved[0]).areaId, from: 'saved' };
  }
  return { kind: 'overview' };
}

// 全体図の初期表示: すべての山域が入る範囲（現在地があれば含める）
export function overviewBounds(entries: AreaEntry[], pos: { lat: number; lng: number } | null): TerrainBounds | null {
  const bs = entries.map((e) => e.bounds);
  if (pos) bs.push({ south: pos.lat, north: pos.lat, west: pos.lng, east: pos.lng });
  if (!bs.length) return null;
  return {
    south: Math.min(...bs.map((b) => b.south)), north: Math.max(...bs.map((b) => b.north)),
    west: Math.min(...bs.map((b) => b.west)), east: Math.max(...bs.map((b) => b.east)),
  };
}

export function fmtMB(bytes: number | null): string {
  return bytes === null ? '—' : `${(bytes / 1e6).toFixed(1)}MB`;
}

// ---- 端末に覚えるもの（読めなくても上の規則で決まる） ----
export function rememberLastArea(areaId: string): void {
  try { localStorage.setItem(LAST_AREA_KEY, areaId); } catch { /* 覚えられなくても使える */ }
}
export function lastArea(): string | null {
  try { return localStorage.getItem(LAST_AREA_KEY); } catch { return null; }
}
export function clearLastArea(): void {
  try { localStorage.removeItem(LAST_AREA_KEY); } catch { /* 同上 */ }
}
// 最後に取れた一覧の要約（オフラインでも未保存の枠と容量を出すため）。地形データ本体は入れない
export function cacheAreasIndex(areas: TerrainAreaSummary[]): void {
  try {
    localStorage.setItem(AREAS_INDEX_CACHE_KEY, JSON.stringify(areas.map(({ areaId, name, version, bounds, totalBytes }) => ({ areaId, name, version, bounds, totalBytes }))));
  } catch { /* 同上 */ }
}
export function cachedAreasIndex(): TerrainAreaSummary[] {
  try {
    const v = JSON.parse(localStorage.getItem(AREAS_INDEX_CACHE_KEY) ?? '[]') as unknown;
    return Array.isArray(v) ? v.filter((a): a is TerrainAreaSummary => !!a && typeof a.areaId === 'string' && !!a.bounds) : [];
  } catch {
    return [];
  }
}
