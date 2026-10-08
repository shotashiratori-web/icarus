import { describe, expect, it } from 'vitest';
import { absoluteGuide, bearingDeg, distanceM, formatDistance, nearArrival, relativeDeg, relativeGuide } from '../src/terrain/navigate';

// 「ここへ行く」（Field Navigation v1 PR3）: 直線距離・方位・向いている方向から見た向き・表示

const FIND = { lat: 43.10494, lng: 140.86263 }; // 初舞茸のミズナラ

describe('距離と方位', () => {
  it('1. 距離は大円（数 m の誤差以内）・同じ点は 0', () => {
    // 緯度 0.001° ≒ 111.2m
    expect(distanceM(FIND, { lat: FIND.lat + 0.001, lng: FIND.lng })).toBeCloseTo(111.2, 0);
    // 初舞茸 → スタッフの記録地点（約 400m 南）
    expect(distanceM(FIND, { lat: 43.10151, lng: 140.86391 })).toBeGreaterThan(380);
    expect(distanceM(FIND, { lat: 43.10151, lng: 140.86391 })).toBeLessThan(400);
    expect(distanceM(FIND, FIND)).toBe(0);
  });

  it('2. 方位は真北から時計回り（北 0・東 90・南 180・西 270、北西は 300 前後）', () => {
    expect(bearingDeg(FIND, { lat: FIND.lat + 0.01, lng: FIND.lng })).toBeCloseTo(0, 3);
    expect(bearingDeg(FIND, { lat: FIND.lat, lng: FIND.lng + 0.01 })).toBeCloseTo(90, 1);
    expect(bearingDeg(FIND, { lat: FIND.lat - 0.01, lng: FIND.lng })).toBeCloseTo(180, 3);
    expect(bearingDeg(FIND, { lat: FIND.lat, lng: FIND.lng - 0.01 })).toBeCloseTo(270, 1);
    const nw = bearingDeg({ lat: 43.1, lng: 140.87 }, FIND);
    expect(nw).toBeGreaterThan(300);
    expect(nw).toBeLessThan(320);
  });
});

describe('向いている方向から見た向き', () => {
  it('3. 目的地の方位 − 向いている方向（正 = 右、0/360 をまたいでも正しく）', () => {
    expect(relativeDeg(305, 350)).toBe(-45); // 北を向いて北西 → 左前
    expect(relativeDeg(10, 350)).toBe(20);
    expect(relativeDeg(170, 350)).toBe(180);
    expect(relativeDeg(90, 90)).toBe(0);
  });

  it('4. 8 方向の言葉と矢印（上 = 向いている方向）', () => {
    expect(relativeGuide(0)).toEqual({ arrow: '↑', text: '正面' });
    expect(relativeGuide(-45)).toEqual({ arrow: '↖', text: '左前方' });
    expect(relativeGuide(45)).toEqual({ arrow: '↗', text: '右前方' });
    expect(relativeGuide(90)).toEqual({ arrow: '→', text: '右' });
    expect(relativeGuide(-100)).toEqual({ arrow: '←', text: '左' });
    expect(relativeGuide(180)).toEqual({ arrow: '↓', text: '後ろ' });
    expect(relativeGuide(-140)).toEqual({ arrow: '↙', text: '左後方' });
  });

  it('5. 向きが分からない時は方角だけ（北が上の地図の矢印）', () => {
    expect(absoluteGuide(305)).toEqual({ arrow: '↖', text: 'NW 305°' });
    expect(absoluteGuide(359.6)).toEqual({ arrow: '↑', text: 'N 0°' });
  });
});

describe('表示', () => {
  it('6. 距離: 100m 未満は 1m 単位、1km 未満は 10m 単位、それ以上は km', () => {
    expect(formatDistance(8.4)).toBe('8m');
    expect(formatDistance(324)).toBe('320m');
    expect(formatDistance(1234)).toBe('1.2km');
    expect(formatDistance(12500)).toBe('13km');
  });

  it('7. 到着の近く: GPS の精度 ＋ 10m 以内（精度が無ければ 10m）', () => {
    expect(nearArrival(20, 12)).toBe(true);
    expect(nearArrival(23, 12)).toBe(false);
    expect(nearArrival(9, null)).toBe(true);
    expect(nearArrival(11, null)).toBe(false);
  });
});
