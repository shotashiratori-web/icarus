import type { TerrainGrid, TerrainManifest } from './types';

// Terrain Engine（§11-2）。格子の値の読み出しと条件判定だけを持ち、対象（舞茸など）を知らない。
// 条件の組み合わせに名前を付けるのは presets.ts（Species Preset）の役目

// 経緯度 → 利用範囲の格子（小数）。Web メルカトルのタイル座標から計算する（build_area.py と同じ式）
export function latLngToGrid(m: TerrainManifest, lat: number, lng: number): { x: number; y: number } {
  const n = 2 ** m.grid.z;
  const la = (lat * Math.PI) / 180;
  const tx = ((lng + 180) / 360) * n;
  const ty = ((1 - Math.log(Math.tan(la) + 1 / Math.cos(la)) / Math.PI) / 2) * n;
  return {
    x: ((tx - m.grid.tx0) * 256) / m.grid.factor - m.grid.cropX,
    y: ((ty - m.grid.ty0) * 256) / m.grid.factor - m.grid.cropY,
  };
}

export function gridToLatLng(m: TerrainManifest, x: number, y: number): { lat: number; lng: number } {
  const n = 2 ** m.grid.z;
  const tx = ((x + m.grid.cropX) * m.grid.factor) / 256 + m.grid.tx0;
  const ty = ((y + m.grid.cropY) * m.grid.factor) / 256 + m.grid.ty0;
  return { lat: (Math.atan(Math.sinh(Math.PI * (1 - (2 * ty) / n))) * 180) / Math.PI, lng: (tx / n) * 360 - 180 };
}

export interface CellValues {
  land: boolean;
  slopeDeg: number;
  sun: number; // 水平で日陰なし = 1.0
  ridgeM: number | null; // null = 約 200m より遠い
  roadM: number | null; // 車で入れる道まで。null = 約 840m より遠い
  trailM: number | null; // 徒歩道まで
}

const FAR = 255;

export function cellIndex(grid: TerrainGrid, x: number, y: number): number | null {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  if (xi < 0 || yi < 0 || xi >= grid.width || yi >= grid.height) return null;
  return yi * grid.width + xi;
}

export function cellValues(m: TerrainManifest, grid: TerrainGrid, i: number): CellValues {
  const j = i * 4;
  const px = m.grid.pxM;
  const dist = (v: number) => (v === FAR ? null : v * px);
  return {
    land: grid.terrain[j + 3] > 0,
    slopeDeg: grid.terrain[j] / m.params.slope_scale,
    sun: grid.terrain[j + 1] / m.params.rel_scale,
    ridgeM: dist(grid.terrain[j + 2]),
    roadM: dist(grid.access[j]),
    trailM: dist(grid.access[j + 1]),
  };
}

// Exploration Mode の条件（地形探索）。距離は m、日射は「上位何%」（利用範囲の陸地の分位点で判定）
export interface ExplorationConditions {
  slopeMinDeg: number;
  sunTopPct: 10 | 20 | 30 | 40 | 50;
  ridgeMaxM: number;
}

// 車道・林道／徒歩道からの距離による区分（アクセス）。A=車道・林道から 100m 以内、B=徒歩道から 300m 以内、C=それ以外
export interface AccessThresholds {
  roadM: number;
  trailM: number;
}
export const DEFAULT_ACCESS: AccessThresholds = { roadM: 100, trailM: 300 };
export type AccessClass = 'A' | 'B' | 'C';

export function sunThreshold(m: TerrainManifest, topPct: ExplorationConditions['sunTopPct']): number {
  return m.relPercentiles[String(100 - topPct) as keyof TerrainManifest['relPercentiles']];
}

// 判定は符号化された整数のまま比べる（描画のたびに 200 万格子を回すため）
export interface CompiledConditions {
  slopeMinRaw: number;
  sunMinRaw: number;
  ridgeMaxPx: number;
  roadMaxPx: number;
  trailMaxPx: number;
}

export function compileConditions(m: TerrainManifest, c: ExplorationConditions, a: AccessThresholds = DEFAULT_ACCESS): CompiledConditions {
  const px = m.grid.pxM;
  return {
    slopeMinRaw: c.slopeMinDeg * m.params.slope_scale,
    sunMinRaw: sunThreshold(m, c.sunTopPct) * m.params.rel_scale,
    ridgeMaxPx: c.ridgeMaxM / px,
    roadMaxPx: a.roadM / px,
    trailMaxPx: a.trailM / px,
  };
}

export function isCandidateRaw(grid: TerrainGrid, i: number, cc: CompiledConditions): boolean {
  const j = i * 4;
  const t = grid.terrain;
  return t[j + 3] > 0 && t[j + 2] <= cc.ridgeMaxPx && t[j] >= cc.slopeMinRaw && t[j + 1] >= cc.sunMinRaw;
}

export function accessClassRaw(grid: TerrainGrid, i: number, cc: CompiledConditions): AccessClass {
  const j = i * 4;
  if (grid.access[j] <= cc.roadMaxPx) return 'A';
  if (grid.access[j + 1] <= cc.trailMaxPx) return 'B';
  return 'C';
}

export interface CandidateStats {
  km2: Record<AccessClass | 'total', number>;
}

export function candidateStats(m: TerrainManifest, grid: TerrainGrid, cc: CompiledConditions): CandidateStats {
  const count = { A: 0, B: 0, C: 0 };
  const n = grid.width * grid.height;
  for (let i = 0; i < n; i++) {
    if (isCandidateRaw(grid, i, cc)) count[accessClassRaw(grid, i, cc)]++;
  }
  const cell = (m.grid.pxM * m.grid.pxM) / 1e6;
  const km2 = (v: number) => Math.round(v * cell * 10) / 10;
  return { km2: { A: km2(count.A), B: km2(count.B), C: km2(count.C), total: km2(count.A + count.B + count.C) } };
}

// 現在地から最寄りの候補（格子で探す。maxM まで）
export function nearestCandidate(
  m: TerrainManifest, grid: TerrainGrid, cc: CompiledConditions, lat: number, lng: number, maxM = 2500,
): { distanceM: number; bearingDeg: number; access: AccessClass } | null {
  const { x, y } = latLngToGrid(m, lat, lng);
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const R = Math.ceil(maxM / m.grid.pxM);
  let best: { dd: number; dx: number; dy: number; i: number } | null = null;
  for (let dy = -R; dy <= R; dy++) {
    const Y = yi + dy;
    if (Y < 0 || Y >= grid.height) continue;
    for (let dx = -R; dx <= R; dx++) {
      const X = xi + dx;
      if (X < 0 || X >= grid.width) continue;
      const dd = dx * dx + dy * dy;
      if (dd > R * R || (best && dd >= best.dd)) continue;
      const i = Y * grid.width + X;
      if (isCandidateRaw(grid, i, cc)) best = { dd, dx, dy, i };
    }
  }
  if (!best) return null;
  const bearing = ((Math.atan2(best.dx, -best.dy) * 180) / Math.PI + 360) % 360;
  return { distanceM: Math.sqrt(best.dd) * m.grid.pxM, bearingDeg: bearing, access: accessClassRaw(grid, best.i, cc) };
}

export function bearingName(deg: number): string {
  return ['北', '北東', '東', '南東', '南', '南西', '西', '北西'][Math.round((((deg % 360) + 360) % 360) / 45) % 8];
}
