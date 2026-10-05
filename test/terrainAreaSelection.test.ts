import { describe, expect, it } from 'vitest';
import { areasAt, areaStatus, canOpen, chooseInitialArea, mergeAreas, overviewBounds } from '../src/terrain/areaSelection';
import type { SavedArea } from '../src/terrain/areaStore';
import type { TerrainAreaSummary, TerrainManifest } from '../src/terrain/types';

// 複数エリア（山域）の選び方。設計 icarus_terrain_multi_area_ui_design.md §2-4・§2-6

const yoichiB = { south: 43.02, north: 43.26, west: 140.62, east: 141.08 };
const nisekoB = { south: 42.72, north: 43.03, west: 140.45, east: 140.96 };
const remote: TerrainAreaSummary[] = [
  { areaId: 'yoichi-akaigawa', name: '余市・赤井川・仁木', version: '20260929-6d7abae2', bounds: yoichiB, totalBytes: 17658012 },
  { areaId: 'niseko-yotei', name: 'ニセコ・羊蹄', version: '20261006-9cb22a8f', bounds: nisekoB, totalBytes: 24342291 },
];
const saved = (areaId: string, version: string, bounds = areaId === 'niseko-yotei' ? nisekoB : yoichiB): SavedArea => ({
  areaId, version, name: areaId, savedAt: '2026-09-29T00:00:00Z', bytes: 1, manifest: { bounds } as TerrainManifest,
});

describe('mergeAreas・状態', () => {
  it('1. 公開中と保存済みをまとめ、北から並べる', () => {
    const e = mergeAreas([...remote].reverse(), [saved('yoichi-akaigawa', '20260929-6d7abae2')], []);
    expect(e.map((x) => x.areaId)).toEqual(['yoichi-akaigawa', 'niseko-yotei']);
    expect(e[0].saved?.version).toBe('20260929-6d7abae2');
    expect(e[1].totalBytes).toBe(24342291);
  });
  it('2. 状態: 保存済み・新しい版・未保存（電波あり）・開けない（電波なし）', () => {
    const e = mergeAreas(remote, [saved('yoichi-akaigawa', '20260901-old')], []);
    expect(areaStatus(e[0], true)).toBe('update');
    expect(areaStatus(e[1], true)).toBe('unsaved');
    expect(canOpen(e[1], true)).toBe('network');
    const off = mergeAreas(null, [saved('yoichi-akaigawa', '20260929-6d7abae2')], remote);
    expect(areaStatus(off[0], false)).toBe('saved');
    expect(areaStatus(off[1], false)).toBe('unavailable');
    expect(canOpen(off[1], false)).toBeNull();
    expect(off[1].remote).toBeNull(); // 前回の一覧から枠と容量だけ出す
    expect(off[1].totalBytes).toBe(24342291);
  });
  it('3. 一覧に無い保存済み（公開を止めた山域）も出す', () => {
    const e = mergeAreas([remote[0]], [saved('niseko-yotei', 'x')], []);
    expect(e.map((x) => x.areaId)).toEqual(['yoichi-akaigawa', 'niseko-yotei']);
  });
});

describe('chooseInitialArea（Gate: 余市だけ保存している人は今までどおり余市が直接開く）', () => {
  it('4. 余市だけ保存・前回の記録なし → 余市（電波があっても全体図にしない）', () => {
    const e = mergeAreas(remote, [saved('yoichi-akaigawa', '20260929-6d7abae2')], []);
    expect(chooseInitialArea(e, null, null)).toEqual({ kind: 'open', areaId: 'yoichi-akaigawa', from: 'saved' });
    expect(chooseInitialArea(e, null, { lat: 42.83, lng: 140.81 })).toEqual({ kind: 'open', areaId: 'yoichi-akaigawa', from: 'saved' });
  });
  it('5. 新規・未保存の端末 → 全体図（電波があっても余市を黙って取りに行かない）', () => {
    expect(chooseInitialArea(mergeAreas(remote, [], []), null, null)).toEqual({ kind: 'overview' });
    expect(chooseInitialArea(mergeAreas(null, [], []), null, null)).toEqual({ kind: 'overview' });
  });
  it('6. 前回の山域が保存済みならそれ。未保存（保存せずに見た）なら全体図か保存済み', () => {
    const both = mergeAreas(remote, [saved('yoichi-akaigawa', 'a'), saved('niseko-yotei', 'b')], []);
    expect(chooseInitialArea(both, 'niseko-yotei', null)).toEqual({ kind: 'open', areaId: 'niseko-yotei', from: 'saved' });
    const onlyY = mergeAreas(remote, [saved('yoichi-akaigawa', 'a')], []);
    expect(chooseInitialArea(onlyY, 'niseko-yotei', null)).toEqual({ kind: 'open', areaId: 'yoichi-akaigawa', from: 'saved' });
    expect(chooseInitialArea(mergeAreas(remote, [], []), 'niseko-yotei', null)).toEqual({ kind: 'overview' });
  });
  it('7. 前回の記録が無く保存済みが 2 つ → 現在地を含む方、無ければ北の方', () => {
    const both = mergeAreas(remote, [saved('yoichi-akaigawa', 'a'), saved('niseko-yotei', 'b')], []);
    expect(chooseInitialArea(both, null, { lat: 42.83, lng: 140.81 })).toMatchObject({ areaId: 'niseko-yotei' });
    expect(chooseInitialArea(both, null, null)).toMatchObject({ areaId: 'yoichi-akaigawa' });
    expect(chooseInitialArea(both, 'gone-area', null)).toMatchObject({ areaId: 'yoichi-akaigawa' });
  });
});

describe('現在地・全体図', () => {
  it('8. 現在地を含む山域（重なりでは保存済みを先に）', () => {
    const e = mergeAreas(remote, [saved('niseko-yotei', 'b')], []);
    expect(areasAt(e, 42.83, 140.81).map((x) => x.areaId)).toEqual(['niseko-yotei']); // 羊蹄山
    expect(areasAt(e, 43.025, 140.8).map((x) => x.areaId)).toEqual(['niseko-yotei', 'yoichi-akaigawa']); // 重なり
    expect(areasAt(e, 43.5, 141.3)).toEqual([]); // 札幌の北
  });
  it('9. 全体図の範囲: すべての山域と現在地が入る', () => {
    const e = mergeAreas(remote, [], []);
    expect(overviewBounds(e, null)).toEqual({ south: 42.72, north: 43.26, west: 140.45, east: 141.08 });
    expect(overviewBounds(e, { lat: 43.06, lng: 141.35 })).toMatchObject({ east: 141.35 });
    expect(overviewBounds([], null)).toBeNull();
  });
});
