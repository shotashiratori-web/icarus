import { describe, expect, it } from 'vitest';
import {
  anyTerrainCondition, describeHydro, directionOf, summarizeDirections, summarizeTerrain, hydroFromPixels, matchTerrain, NO_TERRAIN_CONDITIONS, renderHydro, STREAM_COLOR, STREAM_NOTE, TERRAIN_MATCH_COLOR, wetnessOf,
} from '../src/terrain/hydro';
import type { TerrainManifest } from '../src/terrain/types';

// DEM 由来の地形（Maitake v1 S2）: terrain2.png の読み取り・条件（項目どうし AND、項目の中は OR）・地点情報

const m = {
  grid: { width: 4, height: 1, pxM: 20 },
  params: { twi_min: 2, twi_max: 18 },
  twiPercentiles: { '33': 5, '50': 6, '67': 7, '90': 10 },
} as unknown as TerrainManifest;
const px = (aspectDeg: number | null, streamPx: number, twi: number, landform: number) => {
  const r = aspectDeg === null ? 255 : Math.round((aspectDeg / 360) * 254);
  const q = Math.round(((twi - 2) / 16) * 31);
  return [r, streamPx, (q << 3) | landform, 255];
};
const rgba = new Uint8ClampedArray([
  ...px(225, 0, 9, 6), // 0: 南西・沢の上・湿りやすい・谷
  ...px(180, 5, 4, 1), // 1: 南・沢から 100m・乾きやすい・尾根
  ...px(null, 255, 6, 4), // 2: 平坦・沢から遠い・中・平坦
  ...px(0, 0, 0, 0), // 3: 海
]);
const h = hydroFromPixels(m, rgba, 4, 1);

describe('summarize', () => {
  it('5. 選択中の条件を短く（連続する方位は「〜」、北をまたいでも）', () => {
    expect(summarizeTerrain({ directions: ['S', 'SW', 'W'], landforms: [2, 1], wetness: ['low'], streamWithinM: null, streamBeyondM: 100 })).toBe('南〜西 / 尾根・上部斜面 / 乾燥 / 沢の目安から100m以上');
    expect(summarizeDirections(['NW', 'N', 'NE'])).toBe('北西〜北東');
    expect(summarizeDirections(['N', 'S'])).toBe('北・南');
    expect(summarizeDirections(['S', 'SW'])).toBe('南・南西');
    expect(summarizeDirections(['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'])).toBe('全方位');
    expect(summarizeTerrain({ directions: [], landforms: [], wetness: ['high', 'low'], streamWithinM: 50, streamBeyondM: null })).toBe('乾燥・湿潤 / 沢の目安から50m以内');
    expect(summarizeTerrain({ directions: [], landforms: [], wetness: [], streamWithinM: null, streamBeyondM: null })).toBe('');
  });
});

describe('hydro', () => {
  it('1. terrain2.png の値を戻す（方位・沢距離・TWI の段階・斜面の位置）', () => {
    expect(Array.from(h.landform)).toEqual([6, 1, 4, 0]);
    expect(Array.from(h.streamDist)).toEqual([0, 5, 255, 0]);
    expect(h.aspect[2]).toBe(255);
    expect(directionOf(224)).toBe('SW');
    expect(directionOf(350)).toBe('N');
    expect(directionOf(10)).toBe('N');
    expect(wetnessOf(m, h.twiLevel[0])).toBe('high');
    expect(wetnessOf(m, h.twiLevel[1])).toBe('low');
    expect(() => hydroFromPixels(m, rgba, 2, 2)).toThrow('一致しません');
  });

  it('2. 条件: 項目の中は OR、項目どうしは AND。海は常に外。条件なしなら何も塗らない', () => {
    const c = { ...NO_TERRAIN_CONDITIONS, directions: ['S', 'SW'] as const };
    expect(matchTerrain(m, h, 0, { ...c, directions: [...c.directions] })).toBe(true);
    expect(matchTerrain(m, h, 1, { ...c, directions: [...c.directions] })).toBe(true);
    expect(matchTerrain(m, h, 2, { ...c, directions: [...c.directions] })).toBe(false); // 平坦は方位なし
    expect(matchTerrain(m, h, 0, { ...NO_TERRAIN_CONDITIONS, directions: ['S', 'SW'], landforms: [1] })).toBe(false); // AND
    expect(matchTerrain(m, h, 1, { ...NO_TERRAIN_CONDITIONS, streamWithinM: 50 })).toBe(false); // 100m
    expect(matchTerrain(m, h, 1, { ...NO_TERRAIN_CONDITIONS, streamWithinM: 100 })).toBe(true);
    expect(matchTerrain(m, h, 2, { ...NO_TERRAIN_CONDITIONS, streamBeyondM: 500 })).toBe(true); // 遠い
    expect(matchTerrain(m, h, 3, NO_TERRAIN_CONDITIONS)).toBe(false);
    expect(anyTerrainCondition(NO_TERRAIN_CONDITIONS)).toBe(false);
    expect(renderHydro(m, h, NO_TERRAIN_CONDITIONS, false).image.every((v) => v === 0)).toBe(true);
  });

  it('3. 合う範囲は点、沢の線は青（海の上には描かない）', () => {
    const r = renderHydro(m, h, { ...NO_TERRAIN_CONDITIONS, wetness: ['high', 'mid'] }, true);
    expect(r.matchCells).toBe(2); // 0 と 2
    expect(Array.from(r.image.slice(0, 4))).toEqual(STREAM_COLOR); // 0 は沢の線が上
    expect(Array.from(r.image.slice(8, 12))).toEqual(TERRAIN_MATCH_COLOR); // x=2 は点
    expect(r.image[12 + 3]).toBe(0); // 海の沢距離 0 は描かない
  });

  it('4. 地点情報', () => {
    expect(describeHydro(m, h, 0)).toEqual(['方位 南西（225°）・斜面の位置 谷', '沢の目安の上・湿潤度 湿りやすい（TWI 9.2）', `※${STREAM_NOTE}`]); // 32 段階（約 0.5 刻み）
    expect(describeHydro(m, h, 1)[1]).toContain('沢の目安から約100m');
    expect(describeHydro(m, h, 2)[0]).toContain('方位 平坦');
    expect(describeHydro(m, h, 3)).toEqual([]);
  });
});
