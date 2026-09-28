import { describe, expect, it } from 'vitest';
import {
  accessClassRaw, bearingName, candidateStats, cellIndex, cellValues, compileConditions, gridToLatLng,
  isCandidateRaw, latLngToGrid, nearestCandidate, sunThreshold,
} from '../src/terrain/engine';
import { matchPreset, presetById, SPECIES_PRESETS, CUSTOM_PRESET_ID } from '../src/terrain/presets';
import { renderOverlay, CANDIDATE_COLORS } from '../src/terrain/render';
import type { TerrainGrid, TerrainManifest } from '../src/terrain/types';

// 地形探索 Terrain Engine（Exploration Mode Stage 1）。値の読み出し・条件判定・A/B/C・プリセット・着色

const PX = 20;
function manifest(): TerrainManifest {
  return {
    areaId: 't', name: 'テスト', version: '20260928-00000000', createdAt: '',
    bounds: { south: 43, north: 43.1, west: 140.8, east: 140.9 },
    grid: { width: 4, height: 3, pxM: PX, z: 14, tx0: 14600, ty0: 6010, factor: 3, cropX: 10, cropY: 5 },
    landKm2: 0,
    params: { date: '2026-09-20', slope_scale: 2.8, rel_scale: 170, ridge_dist_max_px: 10, access_dist_max_px: 40 },
    relPercentiles: { '50': 0.96, '60': 1.0, '70': 1.04, '80': 1.1, '90': 1.18 },
    sources: [], files: {} as TerrainManifest['files'],
  };
}

// 1 格子ずつ [傾斜°, 日射, 尾根距離px, 陸, 車道px, 徒歩道px]
type Cell = [number, number, number, boolean, number, number];
function grid(cells: Cell[]): TerrainGrid {
  const m = manifest();
  const terrain = new Uint8ClampedArray(cells.length * 4);
  const access = new Uint8ClampedArray(cells.length * 4);
  cells.forEach(([s, r, d, land, rd, td], i) => {
    terrain.set([s * m.params.slope_scale, r * m.params.rel_scale, d, land ? 255 : 0], i * 4);
    access.set([rd, td, 0, 255], i * 4);
  });
  return { width: 4, height: 3, terrain, access };
}

const maitake = presetById('maitake')!.conditions;
//            傾斜  日射  尾根 陸    車道 徒歩道
const CELLS: Cell[] = [
  [30, 1.2, 0, true, 2, 255], // 0: 候補 A（車道 40m）
  [30, 1.2, 3, true, 10, 12], // 1: 候補 B（車道 200m・徒歩道 240m）
  [30, 1.2, 2, true, 40, 40], // 2: 候補 C
  [20, 1.2, 0, true, 0, 0], // 3: 傾斜不足
  [30, 0.9, 0, true, 0, 0], // 4: 日射不足
  [30, 1.2, 4, true, 0, 0], // 5: 尾根から遠い（80m > 63m）
  [30, 1.2, 255, true, 0, 0], // 6: 尾根から 200m 以上
  [40, 1.3, 0, false, 0, 0], // 7: 海
  [25, 1.04, 3, true, 5, 255], // 8: ちょうど境界（25°・p70・60m）→ 候補 A（車道 100m）
  [30, 1.2, 0, true, 6, 15], // 9: 車道 120m・徒歩道 300m → B
  [30, 1.2, 0, true, 6, 16], // 10: 車道 120m・徒歩道 320m → C
  [0, 0, 255, false, 255, 255], // 11: 海
];

describe('Terrain Engine', () => {
  it('1. 経緯度 ↔ 格子（タイル座標・切り出し位置を含む）が往復で一致する', () => {
    const m = manifest();
    const { lat, lng } = gridToLatLng(m, 1.5, 2.25);
    const g = latLngToGrid(m, lat, lng);
    expect(g.x).toBeCloseTo(1.5, 6);
    expect(g.y).toBeCloseTo(2.25, 6);
    expect(cellIndex(grid(CELLS), g.x, g.y)).toBe(2 * 4 + 1);
    expect(cellIndex(grid(CELLS), -0.1, 0)).toBeNull();
    expect(cellIndex(grid(CELLS), 4, 0)).toBeNull();
  });

  it('2. 格子の値を m・度へ戻す（遠い＝null）', () => {
    const v = cellValues(manifest(), grid(CELLS), 1);
    expect(v).toMatchObject({ land: true, ridgeM: 60, roadM: 200, trailM: 240 });
    expect(v.slopeDeg).toBeCloseTo(30, 0);
    expect(v.sun).toBeCloseTo(1.2, 1);
    expect(cellValues(manifest(), grid(CELLS), 6).ridgeM).toBeNull();
  });

  it('3. 日射の「上位 N%」は利用範囲の分位点（上位 30% = p70）', () => {
    expect(sunThreshold(manifest(), 30)).toBe(1.04);
    expect(sunThreshold(manifest(), 10)).toBe(1.18);
  });

  it('4. 舞茸探索プリセットで候補と A/B/C を判定する（境界を含む）', () => {
    const g = grid(CELLS);
    const cc = compileConditions(manifest(), maitake);
    const cand = CELLS.map((_, i) => isCandidateRaw(g, i, cc));
    expect(cand).toEqual([true, true, true, false, false, false, false, false, true, true, true, false]);
    const cls = [0, 1, 2, 8, 9, 10].map((i) => accessClassRaw(g, i, cc));
    expect(cls).toEqual(['A', 'B', 'C', 'A', 'B', 'C']);
  });

  it('5. 面積（km²）を A/B/C 別に数える', () => {
    const s = candidateStats(manifest(), grid(CELLS), compileConditions(manifest(), maitake));
    const cell = (PX * PX) / 1e6;
    expect(s.km2.A).toBeCloseTo(Math.round(2 * cell * 10) / 10);
    expect(s.km2.total).toBeCloseTo(Math.round(6 * cell * 10) / 10);
  });

  it('6. 現在地から最寄りの候補（距離・方角・区分）', () => {
    const m = manifest();
    const g = grid(CELLS);
    const cc = compileConditions(m, { slopeMinDeg: 30, sunTopPct: 30, ridgeMaxM: 0 });
    // 格子 (3,1)=7 は海。尾根上の候補は (0,0)=A・(1,2)=B・(2,2)=C。最寄りは (2,2)（左下へ √2 格子）
    const here = gridToLatLng(m, 3.5, 1.5);
    const near = nearestCandidate(m, g, cc, here.lat, here.lng)!;
    expect(near.access).toBe('C');
    expect(near.distanceM).toBeCloseTo(Math.SQRT2 * PX, 5);
    expect(bearingName(near.bearingDeg)).toBe('南西');
    expect(nearestCandidate(m, g, cc, here.lat, here.lng, 10)).toBeNull(); // 10m 以内には無い
  });
});

describe('Species Preset', () => {
  it('7. 舞茸探索 = 傾斜 25°・日射 上位 30%・尾根 約 60m。条件を変えると「自分で決める」', () => {
    expect(SPECIES_PRESETS[0]).toMatchObject({ id: 'maitake', label: '舞茸探索', conditions: { slopeMinDeg: 25, sunTopPct: 30, ridgeMaxM: 63 } });
    expect(matchPreset(maitake)).toBe('maitake');
    expect(matchPreset({ ...maitake, slopeMinDeg: 30 })).toBe(CUSTOM_PRESET_ID);
  });
});

describe('renderOverlay', () => {
  it('8. 候補を A/B/C の色で塗り、非表示にした区分は塗らない。海は塗らない', () => {
    const g = grid(CELLS);
    const cc = compileConditions(manifest(), maitake);
    const all = renderOverlay(g, cc, { candidates: { A: true, B: true, C: true }, ridge: false, sun: false }, 170);
    expect(Array.from(all.slice(0, 3))).toEqual(CANDIDATE_COLORS.A);
    expect(Array.from(all.slice(4, 7))).toEqual(CANDIDATE_COLORS.B);
    expect(Array.from(all.slice(8, 11))).toEqual(CANDIDATE_COLORS.C);
    expect(all[3 * 4 + 3]).toBe(0); // 傾斜不足は透明
    const noC = renderOverlay(g, cc, { candidates: { A: true, B: true, C: false }, ridge: false, sun: false }, 170);
    expect(noC[2 * 4 + 3]).toBe(0);
    const withRidge = renderOverlay(g, cc, { candidates: { A: false, B: false, C: false }, ridge: true, sun: false }, 170);
    expect(withRidge[3 * 4 + 3]).toBe(200); // 尾根線（候補でない格子）
    expect(withRidge[7 * 4 + 3]).toBe(0); // 海の尾根は塗らない
  });
});
