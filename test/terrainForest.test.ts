import { describe, expect, it } from 'vitest';
import {
  anyForestLayer, describeForest, FOREST_CLASS, FOREST_COLORS, forestAreaHa, forestFromPixels, mizunaraCommunities, NO_FOREST_LAYERS, parseForestJson, renderForest,
} from '../src/terrain/forest';
import type { TerrainManifest } from '../src/terrain/types';

// 森林レイヤー（Maitake v1 S1）: forest.png / forest.json の読み取り・独立したレイヤー・地点情報（データの年つき）

const json = {
  format: 'forest-v1',
  sources: { kokuyu: { name: '国有林', year: 2018 }, minyu: { name: '民有林', year: 2023 }, veg: { name: '植生図', years: [2021, 2022] as [number, number] } },
  stands: [
    ['k', 2018, '3218 い', [['ミズナラ', null], ['カンバ', null]], 105, '天然生林', 1, 0, 12.3], // 1: ミズナラ1位
    ['k', 2018, '3251 へ', [['カンバ', null], ['ミズナラ', null]], 90, '天然生林', 2, 0, 5], // 2: 2位
    ['k', 2018, '3300 ろ', [['カンバ', null], ['他Ｌ', null], ['ミズナラ', null]], 80, '育成天然林', 3, 0, 5], // 3: 3位
    ['k', 2018, '3301 は', [['トドマツ', null]], 40, '人工林（単層林）', 0, 3, 4], // 4: トドマツ人工林・ミズナラなし
    ['m', 2023, '林班 1 小班 1', [['天然林広葉樹', null]], 66, '天然林', 0, 1, 1], // 5: 樹種不明
    ['m', 2023, '林班 2 小班 3', [['カラマツ', 10]], 45, '人工林', 0, 2, 2], // 6: カラマツ人工林
  ],
  veg: [['050100', 'シラカンバ－ミズナラ群落', 2022, true], ['050200', 'エゾイタヤ－ミズナラ群落', 2021, true], ['110000', '畑雑草群落', 2022, false]],
} as const;

const W = 7, H = 1;
const manifest = { grid: { width: W, height: H, pxM: 20 } } as unknown as TerrainManifest;
// 格子 0..5 = 林分 1..6、格子 6 = なし。植生: 0 と 5 にシラカンバ－ミズナラ、1 にエゾイタヤ－ミズナラ、6 に畑
const rgba = new Uint8ClampedArray(W * 4);
[1, 2, 3, 4, 5, 6, 0].forEach((s, i) => { rgba[i * 4] = s >> 8; rgba[i * 4 + 1] = s & 255; rgba[i * 4 + 3] = 255; });
[1, 2, 0, 0, 0, 1, 3].forEach((v, i) => { rgba[i * 4 + 2] = v; });
const f = forestFromPixels(manifest, rgba, W, H, parseForestJson(json as never));

describe('forest', () => {
  it('1. 林分番号（16 bit）と植生番号を戻す', () => {
    expect(Array.from(f.stand)).toEqual([1, 2, 3, 4, 5, 6, 0]);
    expect(Array.from(f.veg)).toEqual([1, 2, 0, 0, 0, 1, 3]);
    expect(f.stands[0]).toMatchObject({ owner: 'k', year: 2018, mizunaraRank: 1 });
    expect(mizunaraCommunities(f)).toEqual(['シラカンバ－ミズナラ群落', 'エゾイタヤ－ミズナラ群落']);
    const big = new Uint8ClampedArray(4); big[0] = 1; big[1] = 2; // 258
    expect(forestFromPixels({ grid: { width: 1, height: 1 } } as never, big, 1, 1, parseForestJson(json as never)).stand[0]).toBe(258);
    expect(() => parseForestJson({ ...json, format: 'x' } as never)).toThrow('形式');
  });

  it('2. ミズナラ 1〜3 位は別々の色・別々の ON/OFF（1 色に潰さない）', () => {
    const only1 = renderForest(f, { ...NO_FOREST_LAYERS, mz1: true });
    expect(Array.from(only1.slice(0, 4))).toEqual(FOREST_COLORS.mz1);
    expect(only1[4 + 3]).toBe(0); // 2位は出ない
    const all = renderForest(f, { ...NO_FOREST_LAYERS, mz1: true, mz2: true, mz3: true });
    expect(Array.from(all.slice(4, 8))).toEqual(FOREST_COLORS.mz2);
    expect(Array.from(all.slice(8, 12))).toEqual(FOREST_COLORS.mz3);
    expect(FOREST_COLORS.mz1).not.toEqual(FOREST_COLORS.mz2);
    expect(anyForestLayer(NO_FOREST_LAYERS)).toBe(false);
  });

  it('3. 天然林広葉樹（樹種不明）はミズナラのレイヤーに出ない。自分のレイヤーでだけ薄く出る', () => {
    const mz = renderForest(f, { ...NO_FOREST_LAYERS, mz1: true, mz2: true, mz3: true });
    expect(mz[4 * 4 + 3]).toBe(0);
    const bl = renderForest(f, { ...NO_FOREST_LAYERS, broadleafUnknown: true });
    expect(Array.from(bl.slice(16, 20))).toEqual(FOREST_COLORS.broadleafUnknown);
    expect(FOREST_COLORS.broadleafUnknown[3]).toBeLessThan(FOREST_COLORS.mz3[3]); // 薄く
    const pl = renderForest(f, { ...NO_FOREST_LAYERS, larch: true, todo: true, kokuyuNoMizunara: true });
    expect(Array.from(pl.slice(20, 24))).toEqual(FOREST_COLORS.larch);
    expect(Array.from(pl.slice(12, 16))).toEqual(FOREST_COLORS.todo); // 国有林のトドマツ人工林: 林の種類の方を見せる
    const none = renderForest(f, { ...NO_FOREST_LAYERS, kokuyuNoMizunara: true });
    expect(Array.from(none.slice(12, 16))).toEqual(FOREST_COLORS.kokuyuNoMizunara);
    expect(none[4 * 4 + 3]).toBe(0); // 民有林は「国有林でミズナラなし」に入らない
  });

  it('4. 植生図のミズナラ系群落は群落ごとに選べ、林分の塗りと重ねられる（斜線）', () => {
    const v = renderForest(f, { ...NO_FOREST_LAYERS, vegMizunara: ['シラカンバ－ミズナラ群落'] });
    expect(v[3]).toBeGreaterThan(0); // (0,0) は斜線の上
    expect(v[1 * 4 + 3]).toBe(0); // エゾイタヤ－ミズナラは選んでいない
    expect(v[6 * 4 + 3]).toBe(0); // 畑（その他）は出ない
  });

  it('5. 地点情報にデータの年と出どころを必ず出す', () => {
    expect(describeForest(f, 0)).toEqual(['森林計画（国有林 2018時点）: 1位 ミズナラ・2位 カンバ／林齢 105／天然生林', '植生図（2022調査）: シラカンバ－ミズナラ群落']);
    expect(describeForest(f, 4)).toContain('天然林広葉樹は樹種不明（ミズナラかどうか分からない）');
    expect(describeForest(f, 5)[0]).toContain('カラマツ（10割）');
    expect(describeForest(f, 2)[0]).toContain('2位 その他広葉樹'); // 他Ｌ の言い換え
    expect(describeForest(f, 6)).toEqual(['森林計画: 林分の記録なし', '植生図（2022調査）: 畑雑草群落']);
  });

  it('6. 面積（ha）', () => {
    expect(forestAreaHa(f, 100, (s) => s?.mizunaraRank === 1)).toBe(1);
    expect(forestAreaHa(f, 100, (s) => s?.cls === FOREST_CLASS.larch)).toBe(1);
  });
});
