import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cameraKey, loadCamera, loadView, sameShape, saveCamera, saveView, VIEW_KEY } from '../src/terrain/viewState';

// 前回の画面の復元（Field Navigation v1 PR1）。端末に覚えた表示の設定・中心とズームを、形を確かめてから戻す

const memory = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (k: string) => memory.get(k) ?? null,
  setItem: (k: string, v: string) => { memory.set(k, String(v)); },
  removeItem: (k: string) => { memory.delete(k); },
  clear: () => memory.clear(),
});
beforeEach(() => memory.clear());

const DEFAULTS = {
  base: 'offline',
  showContours: true,
  conditions: { slopeMinDeg: 25, sunTopPct: 30, ridgeMaxM: 63 },
  spotKinds: ['alive', 'snag'],
  targetId: null as string | null,
  terrainCond: { directions: [] as string[], streamWithinM: null as number | null },
  forestLayers: { species: null as string | null, mz1: false, vegMizunara: [] as string[] },
};
const YOICHI = { south: 43.02, north: 43.26, west: 140.62, east: 141.08 };

describe('表示の設定', () => {
  it('1. 保存して戻せる（形の合う項目だけ）', () => {
    saveView({ base: 'std', showContours: false, conditions: { slopeMinDeg: 10, sunTopPct: 50, ridgeMaxM: 100 }, spotKinds: ['alive'],
      targetId: 'target-maitake', terrainCond: { directions: ['NW'], streamWithinM: 100 }, forestLayers: { species: 'ミズナラ', mz1: true, vegMizunara: ['シラカンバ－ミズナラ群落'] } });
    expect(loadView(DEFAULTS)).toEqual({ base: 'std', showContours: false, conditions: { slopeMinDeg: 10, sunTopPct: 50, ridgeMaxM: 100 }, spotKinds: ['alive'],
      targetId: 'target-maitake', terrainCond: { directions: ['NW'], streamWithinM: 100 }, forestLayers: { species: 'ミズナラ', mz1: true, vegMizunara: ['シラカンバ－ミズナラ群落'] } });
  });

  it('2. 形が違う・許されない値の項目は捨てる（他の項目は残す）', () => {
    memory.set(VIEW_KEY, JSON.stringify({ v: 1, base: 'satellite3d', showContours: 'yes', conditions: { slopeMinDeg: 10 }, spotKinds: ['alive', 'ufo'], targetId: 'x' }));
    expect(loadView(DEFAULTS, { base: ['offline', 'std'], spotKinds: ['alive', 'snag'] })).toEqual({ targetId: 'x' });
  });

  it('3. 版が違う・壊れている・無い時は何も戻さない（初期表示）', () => {
    memory.set(VIEW_KEY, JSON.stringify({ v: 2, base: 'std' }));
    expect(loadView(DEFAULTS)).toEqual({});
    memory.set(VIEW_KEY, '{壊れた');
    expect(loadView(DEFAULTS)).toEqual({});
    memory.clear();
    expect(loadView(DEFAULTS)).toEqual({});
  });

  it('4. sameShape: null が既定の項目は null・文字列・有限の数だけ。NaN は通さない', () => {
    expect(sameShape(null, 120)).toBe(true);
    expect(sameShape(null, 'a')).toBe(true);
    expect(sameShape(null, NaN)).toBe(false);
    expect(sameShape(null, {})).toBe(false);
    expect(sameShape(1, Infinity)).toBe(false);
  });
});

describe('中心・ズーム（山域ごと）', () => {
  it('5. 山域ごとに保存して戻せる', () => {
    saveCamera('yoichi-akaigawa', { lat: 43.104941234, lng: 140.862631234, zoom: 15.6789 });
    expect(loadCamera('yoichi-akaigawa', YOICHI)).toEqual({ lat: 43.104941, lng: 140.862631, zoom: 15.68 });
    expect(loadCamera('niseko-yotei', YOICHI)).toBeNull();
    expect(memory.has(cameraKey('yoichi-akaigawa'))).toBe(true);
  });

  it('6. 山域の範囲から大きく外れた・ズームがおかしい・壊れた値は使わない（範囲全体で開く）', () => {
    saveCamera('a', { lat: 42.9, lng: 140.86, zoom: 15 });
    expect(loadCamera('a', YOICHI)).toBeNull();
    saveCamera('a', { lat: 43.1, lng: 140.86, zoom: 30 });
    expect(loadCamera('a', YOICHI)).toBeNull();
    memory.set(cameraKey('a'), JSON.stringify({ v: 1, lat: 'x', lng: 140.86, zoom: 15 }));
    expect(loadCamera('a', YOICHI)).toBeNull();
    saveCamera('a', { lat: 43.025, lng: 141.09, zoom: 12 }); // 範囲の端を少し越えた所は許す
    expect(loadCamera('a', YOICHI)).toEqual({ lat: 43.025, lng: 141.09, zoom: 12 });
  });
});
