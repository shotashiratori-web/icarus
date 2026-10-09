import { describe, expect, it } from 'vitest';
import { CONTOUR_STYLE } from '../src/terrain/contours';
import { RIVER_COLOR } from '../src/terrain/rivers';
import { ROAD_STYLE, roadCasing, roadLine } from '../src/terrain/roads';
import type { RoadClass } from '../src/terrain/types';

const CLASSES: RoadClass[] = ['road', 'narrow', 'forest', 'trail'];

describe('道の見た目（森林・陰影・等高線の上でも形が残る）', () => {
  it('全種類に白い縁取り。縁取りは色の線より太く、破線にしない', () => {
    for (const c of CLASSES) {
      const casing = roadCasing(c);
      expect(casing.color).toBe('#fff');
      expect(casing.weight).toBeGreaterThan(roadLine(c).weight);
      expect(casing).not.toHaveProperty('dashArray');
    }
  });

  it('種類は色と線の形で見分ける: 一般道=濃灰、林道=オレンジ実線、幅3m未満=オレンジ破線、登山道=黒点線', () => {
    expect(ROAD_STYLE.forest.color).toBe(ROAD_STYLE.narrow.color);
    expect(roadLine('forest')).not.toHaveProperty('dashArray');
    expect(roadLine('narrow')).toHaveProperty('dashArray');
    expect(roadLine('trail')).toMatchObject({ lineCap: 'round' });
    expect(roadLine('trail')).toHaveProperty('dashArray');
    expect(roadLine('road')).not.toHaveProperty('dashArray');
    expect(ROAD_STYLE.road.color).not.toBe(ROAD_STYLE.forest.color);
  });

  it('等高線の茶・地図の河川の濃紺・「ここへ行く」の赤と同じ色を使わない', () => {
    for (const c of CLASSES) {
      expect([CONTOUR_STYLE.color, RIVER_COLOR, '#d93025']).not.toContain(ROAD_STYLE[c].color);
    }
  });
});
