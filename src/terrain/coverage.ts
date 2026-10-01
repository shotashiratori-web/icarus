import { latLngToGrid } from './engine';
import type { TerrainManifest } from './types';

// 探索範囲（Exploration History Stage 2、設計 §3・§10-2）。「探索済み」は保存しない。
// 表示の時に、絞り込んだセッションの軌跡 × 探索幅（25/50/100/200m）から格子に塗って求める。GPX・D1 は変わらない

export const COVERAGE_WIDTHS_M = [25, 50, 100, 200] as const;
export type CoverageWidth = (typeof COVERAGE_WIDTHS_M)[number];
export const DEFAULT_COVERAGE_WIDTH: CoverageWidth = 50;

// 軌跡から widthM 以内の格子を 1 にした配列（利用範囲の格子と同じ大きさ）
export function buildCoverageMask(m: TerrainManifest, tracks: [number, number][][][], widthM: number): Uint8Array {
  const mask = new Uint8Array(m.grid.width * m.grid.height);
  for (const segments of tracks) forEachCellNearTrack(m, segments, widthM, (i) => { mask[i] = 1; });
  return mask;
}

// 1 本の軌跡（複数の区間）から widthM 以内の格子ごとに visit を呼ぶ（同じ格子に複数回呼ぶことがある）
export function forEachCellNearTrack(m: TerrainManifest, segments: [number, number][][], widthM: number, visit: (i: number) => void): void {
  const W = m.grid.width;
  const H = m.grid.height;
  const R = Math.max(0.5, widthM / m.grid.pxM);
  const Ri = Math.ceil(R);
  const R2 = R * R;
  const stamp = (x: number, y: number) => {
    // 格子の番号は floor（engine の cellIndex と同じ）。round だと半格子ずれる
    const cx = Math.floor(x);
    const cy = Math.floor(y);
    if (cx < -Ri || cy < -Ri || cx >= W + Ri || cy >= H + Ri) return;
    for (let dy = -Ri; dy <= Ri; dy++) {
      const Y = cy + dy;
      if (Y < 0 || Y >= H) continue;
      for (let dx = -Ri; dx <= Ri; dx++) {
        const X = cx + dx;
        if (X < 0 || X >= W || dx * dx + dy * dy > R2) continue;
        visit(Y * W + X);
      }
    }
  };
  for (const seg of segments) {
    let prev: { x: number; y: number } | null = null;
    for (const [lat, lng] of seg) {
      const g = latLngToGrid(m, lat, lng);
      if (!prev) stamp(g.x, g.y);
      else {
        const steps = Math.max(1, Math.ceil(Math.hypot(g.x - prev.x, g.y - prev.y)));
        for (let k = 1; k <= steps; k++) stamp(prev.x + ((g.x - prev.x) * k) / steps, prev.y + ((g.y - prev.y) * k) / steps);
      }
      prev = g;
    }
  }
}

// 点から軌跡までの最短距離（m、局所的な平面近似）
export function distanceToTrackM(lat: number, lng: number, segments: [number, number][][]): number {
  const ky = 111320;
  const kx = 111320 * Math.cos((lat * Math.PI) / 180);
  let best = Infinity;
  for (const seg of segments) {
    for (let i = 0; i < seg.length; i++) {
      const ax = (seg[i][1] - lng) * kx, ay = (seg[i][0] - lat) * ky;
      if (i === 0 || seg.length === 1) { best = Math.min(best, Math.hypot(ax, ay)); continue; }
      const bx = (seg[i - 1][1] - lng) * kx, by = (seg[i - 1][0] - lat) * ky;
      const dx = ax - bx, dy = ay - by;
      const len2 = dx * dx + dy * dy;
      const t = len2 ? Math.max(0, Math.min(1, -(bx * dx + by * dy) / len2)) : 0;
      best = Math.min(best, Math.hypot(bx + t * dx, by + t * dy));
    }
  }
  return best;
}

export type PeriodFilter = 'all' | 'thisYear' | 'last30';
export const PERIOD_LABEL: Record<PeriodFilter, string> = { all: 'すべての期間', thisYear: '今年', last30: '過去30日' };

export function inPeriod(exploredOn: string | null, period: PeriodFilter, today: Date): boolean {
  if (period === 'all') return true;
  if (!exploredOn) return false;
  const jst = new Date(today.getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10);
  if (period === 'thisYear') return exploredOn.slice(0, 4) === jst.slice(0, 4);
  const from = new Date(Date.parse(`${jst}T00:00:00Z`) - 29 * 86400 * 1000).toISOString().slice(0, 10);
  return exploredOn >= from && exploredOn <= jst;
}
