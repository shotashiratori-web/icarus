import { describe, expect, it, vi } from 'vitest';
import type { AreaEntry } from '../src/terrain/areaSelection';
import { gridToLatLng } from '../src/terrain/engine';
import { resolveTerrainSnapshot, snapshotFrom, type DecodedArea } from '../src/terrain/terrainSnapshot';
import type { TerrainManifest } from '../src/terrain/types';

// Spot の記録時の地形は「地点を含む山域」から取る（表示中の山域で判定しない）。
// 回帰: 2026-10-06 マイタケ初の正例。ニセコを表示したまま余市の Field Log から Spot にして terrain_json が { outside: true } になった

const W = 4, H = 3;
function area(areaId: string, version: string, ty0: number, slopeDeg: number): DecodedArea {
  const manifest: TerrainManifest = {
    areaId, name: areaId, version, createdAt: '',
    bounds: { south: 0, north: 0, west: 0, east: 0 },
    grid: { width: W, height: H, pxM: 20, z: 14, tx0: 14600, ty0, factor: 3, cropX: 0, cropY: 0 },
    landKm2: 0,
    params: { date: '2026-09-20', slope_scale: 2.8, rel_scale: 170, ridge_dist_max_px: 10, access_dist_max_px: 40 },
    relPercentiles: { '50': 0.96, '60': 1.0, '70': 1.04, '80': 1.1, '90': 1.18 },
    sources: [], files: {} as TerrainManifest['files'],
  };
  const nw = gridToLatLng(manifest, 0, 0), se = gridToLatLng(manifest, W, H);
  manifest.bounds = { north: nw.lat, west: nw.lng, south: se.lat, east: se.lng };
  const terrain = new Uint8ClampedArray(W * H * 4), access = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < W * H; i++) {
    terrain.set([slopeDeg * 2.8, 170, 3, 255], i * 4);
    access.set([5, 255, 0, 255], i * 4);
  }
  return { manifest, grid: { width: W, height: H, terrain, access }, hydro: null, forest: null };
}

function entry(d: DecodedArea, saved: boolean): AreaEntry {
  const m = d.manifest;
  return {
    areaId: m.areaId, name: m.areaId, bounds: m.bounds, remote: null, totalBytes: null,
    saved: saved ? { areaId: m.areaId, version: m.version, name: m.areaId, manifest: m, savedAt: '', bytes: 0 } : null,
  };
}

const at = (d: DecodedArea) => gridToLatLng(d.manifest, 1.5, 1.5); // 山域の中の 1 点

// 北の山域（余市役）と南の山域（ニセコ役）。傾斜の値を変えて、どちらから取ったか分かるようにする
const yoichi = area('yoichi-akaigawa', '20260929-6d7abae2', 6000, 11);
const niseko = area('niseko-yotei', '20261006-9cb22a8f', 6040, 30);

describe('記録時の地形スナップショット: 地点を含む山域で計算する', () => {
  it('1. 回帰: ニセコを表示中に余市の地点を記録 → 余市（端末に保存済み）の版と値が入る', async () => {
    const loadSaved = vi.fn(async (id: string) => (id === 'yoichi-akaigawa' ? yoichi : null));
    const p = at(yoichi);
    const t = await resolveTerrainSnapshot(p.lat, p.lng, { areaList: [entry(yoichi, true), entry(niseko, true)], current: niseko, loadSaved });
    expect(t).toMatchObject({ status: 'ok', areaId: 'yoichi-akaigawa', terrainVersion: '20260929-6d7abae2', slopeDeg: 11 });
    expect(t.outside).toBeUndefined();
    expect(loadSaved).toHaveBeenCalledWith('yoichi-akaigawa');
  });

  it('2. 逆方向: 余市を表示中にニセコの地点を記録 → ニセコの版と値', async () => {
    const loadSaved = vi.fn(async (id: string) => (id === 'niseko-yotei' ? niseko : null));
    const p = at(niseko);
    const t = await resolveTerrainSnapshot(p.lat, p.lng, { areaList: [entry(yoichi, true), entry(niseko, true)], current: yoichi, loadSaved });
    expect(t).toMatchObject({ status: 'ok', areaId: 'niseko-yotei', terrainVersion: '20261006-9cb22a8f', slopeDeg: 30 });
  });

  it('3. 表示中の山域の地点は、読み込み済みの値を使う（端末から読み直さない）', async () => {
    const loadSaved = vi.fn(async () => null);
    const p = at(yoichi);
    const t = await resolveTerrainSnapshot(p.lat, p.lng, { areaList: [entry(yoichi, true), entry(niseko, true)], current: yoichi, loadSaved });
    expect(t).toMatchObject({ status: 'ok', areaId: 'yoichi-akaigawa', slopeDeg: 11 });
    expect(loadSaved).not.toHaveBeenCalled();
  });

  it('4. 地点の山域が端末に未保存 → 計算せず not_saved（山域は残す。ネットからは取らない）', async () => {
    const loadSaved = vi.fn(async () => yoichi);
    const p = at(yoichi);
    const t = await resolveTerrainSnapshot(p.lat, p.lng, { areaList: [entry(yoichi, false), entry(niseko, true)], current: niseko, loadSaved });
    expect(t).toEqual({ status: 'not_saved', areaId: 'yoichi-akaigawa', areaName: 'yoichi-akaigawa' });
    expect(loadSaved).not.toHaveBeenCalled();
  });

  it('5. どの山域にも入らない → outside（表示中の山域の版は付けない）', async () => {
    const t = await resolveTerrainSnapshot(35.68, 139.76, { areaList: [entry(yoichi, true), entry(niseko, true)], current: niseko, loadSaved: async () => null });
    expect(t).toEqual({ status: 'outside', outside: true });
  });

  it('6. 保存済みの山域が読めなかった時は not_saved（例外で記録を止めない）', async () => {
    const p = at(yoichi);
    const t = await resolveTerrainSnapshot(p.lat, p.lng, { areaList: [entry(yoichi, true)], current: niseko, loadSaved: async () => { throw new Error('IndexedDB'); } });
    expect(t).toMatchObject({ status: 'not_saved', areaId: 'yoichi-akaigawa' });
  });

  it('7. snapshotFrom は格子の外で null、中では山域と版を付ける', () => {
    const p = at(niseko);
    expect(snapshotFrom(yoichi, p.lat, p.lng)).toBeNull();
    expect(snapshotFrom(niseko, p.lat, p.lng)).toMatchObject({ status: 'ok', areaId: 'niseko-yotei', terrainVersion: '20261006-9cb22a8f' });
  });
});
