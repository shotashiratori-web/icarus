import { describe, expect, it } from 'vitest';
import {
  AGE_CLASS_LABEL, ageClass, FOREST_AGE_COLORS, FOREST_COLORS, forestFromPixels, forestHeadline, NO_FOREST_LAYERS, parseForestJson, renderForest,
} from '../src/terrain/forest';
import { isMizunaraLog, mizunaraSearchLayers } from '../src/terrain/mizunaraSearch';
import { buildStatusChips } from '../src/terrain/statusChips';
import { sameShape } from '../src/terrain/viewState';
import type { TerrainManifest } from '../src/terrain/types';

// 「ミズナラを探す」と 林齢（林分）表示（icarus_forest_stand_age_view_v1_design.md）。林齢は色だけで、林分を消さない

const json = {
  format: 'forest-v1',
  sources: { kokuyu: { name: '国有林', year: 2018 } },
  stands: [
    ['k', 2018, 'a', [['ミズナラ', null], ['カンバ', null]], 155, '天然生林', 1, 0, 1], // 1: 1位・150+
    ['k', 2018, 'b', [['カンバ', null], ['ミズナラ', null]], 95, '天然生林', 2, 0, 1], // 2: 2位・80〜99（初舞茸と同じ形）
    ['k', 2018, 'c', [['カンバ', null], ['他Ｌ', null], ['ミズナラ', null]], 120, '天然生林', 3, 0, 1], // 3: 3位・120〜149
    ['k', 2018, 'd', [['ミズナラ', null]], null, null, 1, 0, 1], // 4: 1位・林齢の記録なし
    ['k', 2018, 'e', [['トドマツ', null]], 40, '人工林', 0, 3, 1], // 5: ミズナラなし
  ],
  veg: [['050100', 'シラカンバ－ミズナラ群落', 2022, true]],
} as const;
const W = 5;
const manifest = { grid: { width: W, height: 1, pxM: 20 } } as unknown as TerrainManifest;
const rgba = new Uint8ClampedArray(W * 4);
[1, 2, 3, 4, 5].forEach((s, i) => { rgba[i * 4 + 1] = s; rgba[i * 4 + 3] = 255; });
const f = forestFromPixels(manifest, rgba, W, 1, parseForestJson(json as never));
const px = (o: Uint8ClampedArray, i: number) => Array.from(o.slice(i * 4, i * 4 + 4));
const all = { ...NO_FOREST_LAYERS, species: 'ミズナラ', mz1: true, mz2: true, mz3: true };

describe('林齢（林分）の階級', () => {
  it('境目は 80・100・120・150。記録なしは none', () => {
    expect([79, 80, 99, 100, 119, 120, 149, 150].map(ageClass)).toEqual(['lt80', 'a80', 'a80', 'a100', 'a100', 'a120', 'a120', 'a150']);
    expect(ageClass(null)).toBe('none');
    expect(AGE_CLASS_LABEL.none).toBe('林齢（林分）：記録なし');
    expect(Object.values(AGE_CLASS_LABEL).join()).not.toContain('樹齢');
  });
});

describe('森林計画の塗り', () => {
  it('順位で見る は今と同じ（view なし・rank でバイト一致）', () => {
    const before = renderForest(f, all);
    expect(Array.from(renderForest(f, { ...all, view: 'rank' }))).toEqual(Array.from(before));
    expect(px(before, 1)).toEqual(FOREST_COLORS.mz2);
  });

  it('林齢で見る: 塗る林分は同じで色だけ階級。記録なしは灰色で残す（消さない）', () => {
    const o = renderForest(f, { ...all, view: 'age' });
    expect(px(o, 0)).toEqual(FOREST_AGE_COLORS.a150);
    expect(px(o, 1)).toEqual(FOREST_AGE_COLORS.a80); // 95 年・2 位（初舞茸の形）が塗られている
    expect(px(o, 2)).toEqual(FOREST_AGE_COLORS.a120);
    expect(px(o, 3)).toEqual(FOREST_AGE_COLORS.none);
    expect(px(o, 4)).toEqual([0, 0, 0, 0]); // ミズナラの無い林分は塗らない
  });

  it('林齢で見る でも、チェックを外した順位は塗らない', () => {
    const o = renderForest(f, { ...all, mz1: false, view: 'age' });
    expect(px(o, 0)).toEqual([0, 0, 0, 0]);
    expect(px(o, 1)).toEqual(FOREST_AGE_COLORS.a80);
  });

  it('地点情報: 林齢（林分）○年。林齢で見る時は階級を添える', () => {
    expect(forestHeadline(f, 1).note).toBe('森林計画（国有林 2018時点・林齢（林分）95年・天然生林）');
    expect(forestHeadline(f, 1, 'age').note).toBe('森林計画（国有林 2018時点・林齢（林分）95年・天然生林・80〜99年の階級）');
    expect(forestHeadline(f, 3, 'age').note).toBe('森林計画（国有林 2018時点・林齢（林分）：記録なし）');
  });
});

describe('ミズナラを探す', () => {
  it('押した直後: 1〜3 位すべて・群落すべて・樹種不明は OFF。他の森林の設定は残す', () => {
    const l = mizunaraSearchLayers({ ...NO_FOREST_LAYERS, species: 'カンバ', mz1: true, broadleafUnknown: true, larch: true }, ['A群落', 'B群落']);
    expect(l).toMatchObject({ species: 'ミズナラ', mz1: true, mz2: true, mz3: true, vegMizunara: ['A群落', 'B群落'], broadleafUnknown: false, larch: true });
  });

  it('Field Log のミズナラ: 食材名に「ミズナラ」を含み、位置がある記録', () => {
    expect(isMizunaraLog({ foodName: 'ミズナラ', lat: 43, lng: 140 })).toBe(true);
    expect(isMizunaraLog({ foodName: 'ミズナラ・舞茸あった！', lat: 43, lng: 140 })).toBe(true);
    expect(isMizunaraLog({ foodName: '舞茸', lat: 43, lng: 140 })).toBe(false);
    expect(isMizunaraLog({ foodName: 'ミズナラ', lat: NaN, lng: 140 })).toBe(false);
  });

  it('チップ: 「ミズナラを探す」1 つ（林齢で見る時はそれと分かる）。解除すると今までの森林のチップ', () => {
    const base = { forestAny: true, candidates: { A: false, B: false, C: false }, terrainSummary: null, matchKm2: null, targetName: null, fieldLogLabel: null, ridge: false, sun: false };
    expect(buildStatusChips({ ...base, forest: all, mizunaraSearch: true })[0].label).toBe('ミズナラを探す');
    expect(buildStatusChips({ ...base, forest: { ...all, view: 'age' }, mizunaraSearch: true })[0].label).toBe('ミズナラを探す・林齢（林分）');
    expect(buildStatusChips({ ...base, forest: all })[0].label).toBe('ミズナラ 1–3位');
  });

  it('前の版で保存した森林の設定（view なし）も、そのまま読める', () => {
    const old = { ...NO_FOREST_LAYERS, species: 'ミズナラ', mz2: true };
    expect(sameShape(NO_FOREST_LAYERS, old)).toBe(true);
  });
});
