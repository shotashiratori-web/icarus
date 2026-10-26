import { describe, expect, it } from 'vitest';
import { describeRoad, indexRoads, nearestRoad, roadAtTap, tapToleranceM, TRAIL_CLASSES, VEHICLE_CLASSES } from '../src/terrain/roads';
import type { RoadLine } from '../src/terrain/types';

// 道を押した時の「この道」（2D）。名前があれば名前（種類）、無ければ種類だけ
const lines: RoadLine[] = [
  { c: 'forest', p: [[43.13, 140.83], [43.13, 140.84]], n: '梅川林道', f: 'gravel' },
  { c: 'narrow', p: [[43.12, 140.83], [43.12, 140.84]] },
  { c: 'trail', p: [[43.11, 140.83], [43.11, 140.84]] },
];
const idx = indexRoads(lines);

describe('道を押した時', () => {
  it('指 1 本分（12px）の幅: 寄ると約 10m（z17）、引くと約 40m（z15）', () => {
    expect(tapToleranceM(43.13, 17)).toBeCloseTo(10.5, 0);
    expect(tapToleranceM(43.13, 15)).toBeCloseTo(41.9, 0);
  });
  it('名前のある道は「この道：名前（種類）・舗装」', () => {
    expect(roadAtTap(idx, 43.13005, 140.835, VEHICLE_CLASSES, 10)).toBe('この道：梅川林道（林道・作業道）・砂利');
  });
  it('名前の無い道は種類だけ', () => {
    expect(roadAtTap(idx, 43.12, 140.835, VEHICLE_CLASSES, 10)).toBe('この道：幅3m未満の道');
    expect(roadAtTap(idx, 43.11, 140.835, TRAIL_CLASSES, 10)).toBe('この道：登山道・徒歩道');
  });
  it('幅の外・表示していない種類の道は出さない', () => {
    expect(roadAtTap(idx, 43.1302, 140.835, VEHICLE_CLASSES, 10)).toBeNull(); // 約 22m 離れている
    expect(roadAtTap(idx, 43.11, 140.835, VEHICLE_CLASSES, 10)).toBeNull(); // 登山道は車道の種類に入らない
    expect(roadAtTap(idx, 43.13, 140.835, [], 10)).toBeNull();
  });
  it('最寄りの道の行も舗装を日本語で出す', () => {
    expect(describeRoad(nearestRoad(idx, 43.1301, 140.835, VEHICLE_CLASSES))).toBe('約10m（梅川林道・砂利）');
  });
});
