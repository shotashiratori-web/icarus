import { describe, expect, it } from 'vitest';
import { RIVER_COLOR, RIVER_EDGE_COLOR } from '../src/terrain/rivers';
import { ROAD_STYLE } from '../src/terrain/roads';
import { TRACK_CASING, TRACK_COLOR, TRACK_LINE } from '../src/terrain/trackStyle';

describe('探索履歴（GPX）の線の見た目（パターン C）', () => {
  it('細い青＋細い白縁。白縁は青より太い', () => {
    expect(TRACK_LINE).toMatchObject({ color: TRACK_COLOR, weight: 2.5 });
    expect(TRACK_CASING).toMatchObject({ color: '#fff', weight: 4.5 });
    expect(TRACK_CASING.weight).toBeGreaterThan(TRACK_LINE.weight);
  });

  it('押せる幅（白縁）は以前の青い線（4）より狭くしない', () => {
    expect(TRACK_CASING.weight).toBeGreaterThanOrEqual(4);
  });

  it('地図の河川・道と同じ色を使わない', () => {
    const others = [RIVER_COLOR, RIVER_EDGE_COLOR, ...Object.values(ROAD_STYLE).map((s) => s.color)];
    expect(others).not.toContain(TRACK_COLOR);
  });
});
