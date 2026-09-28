import { describe, expect, it } from 'vitest';
import { buildCoverageMask, distanceToTrackM, inPeriod } from '../src/terrain/coverage';
import { candidateStats, compileConditions, gridToLatLng, nearestCandidate } from '../src/terrain/engine';
import { EXPLORED_COLOR, renderOverlay } from '../src/terrain/render';
import type { TerrainGrid, TerrainManifest } from '../src/terrain/types';

// 探索範囲（Exploration History Stage 2 Web）: 「探索済み」は保存せず、軌跡 × 探索幅 × 絞り込みから毎回求める

const PX = 20;
const W = 40, H = 30;
function manifest(): TerrainManifest {
  return {
    areaId: 't', name: 't', version: 'v', createdAt: '', bounds: { south: 43, north: 43.1, west: 140.8, east: 140.9 },
    grid: { width: W, height: H, pxM: PX, z: 14, tx0: 14600, ty0: 6010, factor: 3, cropX: 0, cropY: 0 },
    landKm2: 0, params: { date: '', slope_scale: 2.8, rel_scale: 170, ridge_dist_max_px: 10, access_dist_max_px: 40 },
    relPercentiles: { '50': 0.9, '60': 1, '70': 1, '80': 1.1, '90': 1.2 }, sources: [], files: {} as TerrainManifest['files'],
  };
}
// 全部の格子が候補（尾根上・急斜面・日当たり良・道から遠い＝C）
function allCandidates(): TerrainGrid {
  const t = new Uint8ClampedArray(W * H * 4), a = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < W * H; i++) { t.set([30 * 2.8, 1.2 * 170, 0, 255], i * 4); a.set([255, 255, 0, 255], i * 4); }
  return { width: W, height: H, terrain: t, access: a };
}
// 格子の x=10 の縦の線（y=5..25）の軌跡
function verticalTrack(x: number): [number, number][][] {
  const m = manifest();
  return [[5, 25].map((y) => { const p = gridToLatLng(m, x + 0.5, y + 0.5); return [p.lat, p.lng] as [number, number]; })];
}
const count = (mask: Uint8Array) => mask.reduce((s, v) => s + v, 0);

describe('buildCoverageMask', () => {
  it('1. 探索幅を広げると探索済みの格子が増える（GPX は同じ）。軌跡が無ければ 0', () => {
    const m = manifest();
    const t = [verticalTrack(10)];
    const c25 = count(buildCoverageMask(m, t, 25));
    const c50 = count(buildCoverageMask(m, t, 50));
    const c100 = count(buildCoverageMask(m, t, 100));
    const c200 = count(buildCoverageMask(m, t, 200));
    expect(c25).toBeGreaterThan(0);
    expect(c25).toBeLessThan(c50);
    expect(c50).toBeLessThan(c100);
    expect(c100).toBeLessThan(c200);
    expect(count(buildCoverageMask(m, [], 50))).toBe(0);
    // 50m（2.5 格子）: 線から 2 格子は入り、3 格子は入らない
    const mask = buildCoverageMask(m, t, 50);
    expect(mask[15 * W + 12]).toBe(1);
    expect(mask[15 * W + 13]).toBe(0);
  });

  it('2. 候補を未探索と探索済みに分けて数え、塗り分ける。最寄りの候補は未探索だけを探す', () => {
    const m = manifest();
    const g = allCandidates();
    const cc = compileConditions(m, { slopeMinDeg: 25, sunTopPct: 30, ridgeMaxM: 0 });
    const mask = buildCoverageMask(m, [verticalTrack(10)], 50);
    const s = candidateStats(m, g, cc, mask);
    const cell = (PX * PX) / 1e6;
    expect(s.exploredKm2.C).toBeCloseTo(Math.round(count(mask) * cell * 100) / 100, 5);
    expect(s.km2.C).toBeCloseTo(Math.round((W * H - count(mask)) * cell * 100) / 100, 5);
    const img = renderOverlay(g, cc, { candidates: { A: true, B: true, C: true }, ridge: false, sun: false, exploredCandidates: true }, 170, undefined, mask);
    const i = 15 * W + 10;
    expect(Array.from(img.slice(i * 4, i * 4 + 3))).toEqual(EXPLORED_COLOR);
    // 軌跡の上にいても、最寄りの「未探索」の候補を指す（探索済みの足元ではない）
    const here = gridToLatLng(m, 10.5, 15.5);
    const near = nearestCandidate(m, g, cc, here.lat, here.lng, 2500, mask)!;
    expect(near.distanceM).toBeCloseTo(3 * PX, 5);
    expect(nearestCandidate(m, g, cc, here.lat, here.lng, 2500, null)!.distanceM).toBe(0);
  });

  it('3. 地点から軌跡までの距離（地点タップの「過去探索」の判定）', () => {
    const seg: [number, number][][] = [[[43.0, 140.0], [43.0, 140.01]]];
    expect(distanceToTrackM(43.0003, 140.005, seg)).toBeCloseTo(0.0003 * 111320, 0);
    expect(distanceToTrackM(43.0, 139.99, seg)).toBeGreaterThan(800);
  });
});

describe('inPeriod（「今年は未探索」「過去 30 日では未探索」の絞り込み）', () => {
  const today = new Date('2026-09-28T03:00:00Z'); // JST 2026-09-28
  it('4. 今年・過去 30 日・すべて', () => {
    expect(inPeriod('2026-01-02', 'thisYear', today)).toBe(true);
    expect(inPeriod('2025-12-31', 'thisYear', today)).toBe(false);
    expect(inPeriod('2026-08-30', 'last30', today)).toBe(true);
    expect(inPeriod('2026-08-29', 'last30', today)).toBe(false);
    expect(inPeriod(null, 'last30', today)).toBe(false);
    expect(inPeriod(null, 'all', today)).toBe(true);
  });
});
