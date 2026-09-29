import { describe, expect, it } from 'vitest';
import { headingFromEvent, headingLabel, rotorSize, screenToMapPoint, smoothAngle } from '../src/terrain/heading';

// 進行方向モード: 向きの読み取り・なめらか化・表示・回転した地図のタップ位置

describe('heading', () => {
  it('1. iOS は webkitCompassHeading、ほかは絶対 alpha（反時計回り）。画面の向きも足す', () => {
    expect(headingFromEvent({ alpha: 10, webkitCompassHeading: 312 }, 0, 0)).toBe(312);
    expect(headingFromEvent({ alpha: 90, absolute: true }, 0, 0)).toBe(270);
    expect(headingFromEvent({ alpha: 90, absolute: false }, 0, 0)).toBeNull(); // 相対値は使わない
    expect(headingFromEvent({ alpha: null, webkitCompassHeading: 350 }, 90, 0)).toBe(80); // 横向き
  });

  it('1b. 磁北 → 真北（余市付近は西偏 約 9.5°）: コンパスが 0°（磁北）なら真北では 350.5°', () => {
    expect(headingFromEvent({ alpha: null, webkitCompassHeading: 0 }, 0)).toBeCloseTo(350.5, 6);
    expect(headingFromEvent({ alpha: null, webkitCompassHeading: 100 }, 0)).toBeCloseTo(90.5, 6);
  });

  it('2. 0/360 をまたいでもなめらかに', () => {
    expect(smoothAngle(null, 10)).toBe(10);
    expect(smoothAngle(350, 10, 0.5)).toBeCloseTo(0, 5);
    expect(smoothAngle(10, 350, 0.5)).toBeCloseTo(0, 5);
    expect(smoothAngle(90, 180, 0.25)).toBeCloseTo(112.5, 5);
  });

  it('3. 表示「↖ NW 312°」', () => {
    expect(headingLabel(312)).toBe('↖ NW 312°');
    expect(headingLabel(0)).toBe('↑ N 0°');
    expect(headingLabel(359.6)).toBe('↑ N 0°');
    expect(headingLabel(225)).toBe('↙ SW 225°');
  });

  it('4. 回転した地図のタップ位置を回転前へ戻す', () => {
    const a = { x: 200, y: 400 };
    // 向き 0°: そのまま（地図の中心 = anchor）
    expect(screenToMapPoint({ x: 200, y: 300 }, a, 1000, 0)).toEqual({ x: 500, y: 400 });
    // 向き 90°（東を向く）: 画面の上 = 東 → 地図（北が上）では右
    const p = screenToMapPoint({ x: 200, y: 300 }, a, 1000, 90);
    expect(p.x).toBeCloseTo(600, 6);
    expect(p.y).toBeCloseTo(500, 6);
    // 向き 180°: 画面の上 = 南 → 地図では下
    const q = screenToMapPoint({ x: 200, y: 300 }, a, 1000, 180);
    expect(q.x).toBeCloseTo(500, 6);
    expect(q.y).toBeCloseTo(600, 6);
  });

  it('5. 回しても四隅が空かない大きさ', () => {
    expect(rotorSize(400, 800, { x: 200, y: 480 })).toBeGreaterThanOrEqual(2 * Math.hypot(200, 480));
  });
});
