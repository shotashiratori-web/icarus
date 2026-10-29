import { describe, expect, it } from 'vitest';
import { trackLine, tracksAtTap, type TrackTapEntry } from '../src/exploration/trackTap';

// 探索履歴（GPX）の線を押した時（2D・3D）。近い順に最大 3 本、今の小窓と同じ中身
const entry = (over: Partial<TrackTapEntry>): TrackTapEntry => ({
  exploredOn: '2026-10-26', purpose: 'mushroom', explorerNames: ['翔大'], distanceM: 3745, rawDistanceM: 3745, useRange: null,
  targets: [{ target: 'エノキ', result: 'not_found' }], hypothesis: null, origin: 'server', status: 'registered',
  track: [[[43.13, 140.83], [43.13, 140.84]]], ...over,
});

describe('GPX の線を押した時', () => {
  it('1 行: 日付・目的・歩いた人・距離（対象の結果）', () => {
    expect(trackLine(entry({}))).toBe('この線：2026-10-26・きのこ全般・翔大・3.7km（エノキ: 見つからなかった）');
  });
  it('区間を使った記録・仮説・端末だけの記録', () => {
    const s = trackLine(entry({ useRange: { from: 0, to: 1 }, rawDistanceM: 5200, hypothesis: { name: 'v0', conditionText: ['北向き', '沢沿い'] }, origin: 'device', status: 'saved', targets: [] }));
    expect(s).toBe('この線：2026-10-26・きのこ全般・翔大・3.7km（記録全体 5.2km）・仮説「v0」（北向き かつ 沢沿い）・この端末のみ（未登録）');
  });
  it('幅の中の線だけを近い順に、最大 3 本', () => {
    const es = [
      entry({ exploredOn: 'far', track: [[[43.1302, 140.83], [43.1302, 140.84]]] }), // 約 22m
      entry({ exploredOn: 'b', track: [[[43.13005, 140.83], [43.13005, 140.84]]] }), // 約 5.6m
      entry({ exploredOn: 'a' }), // 0m
      entry({ exploredOn: 'c', track: [[[43.13008, 140.83], [43.13008, 140.84]]] }),
      entry({ exploredOn: 'd', track: [[[43.13009, 140.83], [43.13009, 140.84]]] }),
      entry({ exploredOn: 'none', track: null }),
    ];
    expect(tracksAtTap(es, 43.13, 140.835, 15).map((s) => s.split('・')[0])).toEqual(['この線：a', 'この線：b', 'この線：c']);
    expect(tracksAtTap(es, 43.14, 140.835, 15)).toEqual([]);
  });
});
