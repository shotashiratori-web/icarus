import { describe, expect, it } from 'vitest';
import { describeForest, DOYURIN_SPECIES_NOTE, forestFromPixels, forestHeadline, parseForestJson } from '../src/terrain/forest';
import { standRanks } from '../src/terrain/forestSpecies';
import type { TerrainManifest } from '../src/terrain/types';

// 道有林（owner 'd'）: 小班ごとに 1 樹種だけの記録（割合なし）。国有林・民有林と区別して表示し、「1位」と書かない
// 設計: icarus/docs/architecture/icarus_forest_doyurin_import_design.md §6

const json = {
  format: 'forest-v1',
  sources: { kokuyu: { name: '国有林', year: 2018 }, minyu: { name: '民有林', year: 2023 }, veg: { name: '植生図', years: [2021, 2022] as [number, number] }, doyurin: { name: '道有林', year: 2022 } },
  stands: [
    ['d', 2022, '林班 39 小班 54', [['ミズナラ', null]], 20, '人工林', 1, 0, 2.04], // 1: 道有林・ミズナラ
    ['d', 2022, '林班 1 小班 1', [['天然林広葉樹', null]], null, '天然林', 0, 1, 66.5], // 2: 道有林・樹種不明
    ['d', 2022, '林班 5 小班 9', [], null, '未立木地', 0, 0, 3], // 3: 道有林・樹種の記録なし（未立木地）
    ['d', 2022, '林班 7 小班 2', [['トドマツ', null]], 51, '人工林（複層林・記録は下から2層目）', 0, 3, 5], // 4: 複層林
    ['m', 2023, '林班 2 小班 3', [['ミズナラ', 6], ['カンバ', 4]], 45, '天然林', 1, 0, 2], // 5: 民有林（比較）
    ['k', 2018, '3218 い', [['カンバ', null]], 90, '天然生林', 0, 0, 1], // 6: 国有林（比較）
  ],
  veg: [['050100', 'シラカンバ－ミズナラ群落', 2022, true]],
} as const;

const W = 6;
const rgba = new Uint8ClampedArray(W * 4);
[1, 2, 3, 4, 5, 6].forEach((s, i) => { rgba[i * 4 + 1] = s; rgba[i * 4 + 2] = 1; rgba[i * 4 + 3] = 255; });
const f = forestFromPixels({ grid: { width: W, height: 1, pxM: 20 } } as unknown as TerrainManifest, rgba, W, 1, parseForestJson(json as never));

describe('道有林の表示', () => {
  it('1. 地点情報: 「道有林 2022時点」と 1 樹種のみの記録。「1位」と書かない', () => {
    expect(describeForest(f, 0)[0]).toBe(`森林計画（道有林 2022時点）: 樹種 ミズナラ（${DOYURIN_SPECIES_NOTE}）／林齢 20／人工林`);
    expect(describeForest(f, 0)[0]).not.toContain('1位');
    expect(describeForest(f, 3)[0]).toContain('人工林（複層林・記録は下から2層目）');
    expect(describeForest(f, 3)[0]).not.toContain('undefined');
  });

  it('2. 樹種の記録なし（未立木地）は樹種を出さない。林齢 null は出さない', () => {
    expect(describeForest(f, 2)[0]).toBe('森林計画（道有林 2022時点）: 樹種の記録なし／未立木地');
    expect(describeForest(f, 1)[0]).toBe(`森林計画（道有林 2022時点）: 樹種 天然林広葉樹（${DOYURIN_SPECIES_NOTE}）／天然林`);
  });

  it('3. 見出し: 樹種不明でも出どころの行で道有林・1 樹種のみと分かる', () => {
    expect(forestHeadline(f, 1)).toMatchObject({ species: '天然林広葉樹（樹種不明）', note: `森林計画（道有林 2022時点・天然林）・${DOYURIN_SPECIES_NOTE}` });
    expect(forestHeadline(f, 0).species).toBe(`樹種 ミズナラ（${DOYURIN_SPECIES_NOTE}）`);
  });

  it('4. 国有林・民有林は今までどおり（1〜3 位・割合）', () => {
    expect(describeForest(f, 4)[0]).toBe('森林計画（民有林 2023時点）: 1位 ミズナラ（6割）・2位 カンバ（4割）／林齢 45／天然林');
    expect(describeForest(f, 5)[0]).toBe('森林計画（国有林 2018時点）: 1位 カンバ／林齢 90／天然生林');
    expect(forestHeadline(f, 4).note).toBe('森林計画（民有林 2023時点・林齢45・天然林）');
  });

  it('5. 樹種の塗り: 道有林の樹種は 1 位として塗り、樹種の記録なしは塗らない', () => {
    const r = standRanks(f, 'ミズナラ'); // 林分番号 - 1 で引く
    expect(r[0]).toBe(1); // 林分 1: 道有林のミズナラ
    expect(r[2]).toBe(0); // 林分 3: 未立木地（樹種の記録なし）
    expect(standRanks(f, 'トドマツ')[3]).toBe(1); // 林分 4: 複層林のトドマツ
  });
});
