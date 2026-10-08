import { describe, expect, it } from 'vitest';
import { gridToLatLng } from '../src/terrain/engine';
import { decodeRivers, mapRiverDistanceM, riverDistanceText } from '../src/terrain/rivers';
import { packageFilesOf, type AreaPackage } from '../src/terrain/areaStore';
import { snapshotFrom, terrainRows, type DecodedArea } from '../src/terrain/terrainSnapshot';
import { STREAM_COLOR } from '../src/terrain/hydro';
import type { TerrainManifest } from '../src/terrain/types';

// River Basemap v1: 地図の河川を地形パッケージ（rivers.json）から。2D は常に表示、記録時の地形に riverM。
// DEM の沢の目安とは別物（名前・色・値を分ける）。設計: icarus_terrain_rivers_package_design.md

const W = 4, H = 3;
function area(withRivers: boolean): DecodedArea {
  const manifest: TerrainManifest = {
    areaId: 'yoichi-akaigawa', name: '余市・赤井川・仁木', version: '20261008-04135ca8', createdAt: '',
    bounds: { south: 0, north: 0, west: 0, east: 0 },
    grid: { width: W, height: H, pxM: 20, z: 14, tx0: 14600, ty0: 5960, factor: 3, cropX: 0, cropY: 0 },
    landKm2: 0,
    params: { date: '2026-09-20', slope_scale: 2.8, rel_scale: 170, ridge_dist_max_px: 10, access_dist_max_px: 40 },
    relPercentiles: { '50': 0.96, '60': 1.0, '70': 1.04, '80': 1.1, '90': 1.18 },
    sources: [], files: {} as TerrainManifest['files'],
  };
  const terrain = new Uint8ClampedArray(W * H * 4), access = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < W * H; i++) { terrain.set([28, 170, 3, 255], i * 4); access.set([5, 255, 0, 255], i * 4); }
  const p = gridToLatLng(manifest, 1.5, 1.5);
  // 地点の真北 約 1,076m の東西の川（初舞茸の木と同じ距離）
  const north = p.lat + 1076 / 110540;
  const rivers = withRivers ? { c: [[[north, p.lng - 0.02], [north, p.lng + 0.02]] as [number, number][]], e: [] } : null;
  return { manifest, grid: { width: W, height: H, terrain, access }, hydro: null, forest: null, rivers };
}

const pkg = (files: Record<string, string>) => ({ files: Object.fromEntries(Object.entries(files).map(([k, v]) => [k, new Blob([v])])) }) as unknown as AreaPackage;

describe('River Basemap v1', () => {
  it('1. rivers.json の無い古い版は null（河川なしで今までどおり）、形が違えば読まない', async () => {
    expect(await decodeRivers(pkg({}))).toBeNull();
    expect(await decodeRivers(pkg({ 'rivers.json': '{"c":[[[43.1,140.8],[43.2,140.9]]],"e":[]}' }))).toEqual({ c: [[[43.1, 140.8], [43.2, 140.9]]], e: [] });
    await expect(decodeRivers(pkg({ 'rivers.json': '{"lines":[]}' }))).rejects.toThrow(/形が違います/);
  });

  it('2. 保存するファイル: manifest に rivers.json がある版だけ取りに行く', () => {
    const base = { 'terrain.png': {}, 'access.png': {}, 'roads.json': {}, 'hillshade.jpg': {} };
    expect(packageFilesOf({ files: base } as unknown as TerrainManifest)).not.toContain('rivers.json');
    expect(packageFilesOf({ files: { ...base, 'rivers.json': {} } } as unknown as TerrainManifest)).toContain('rivers.json');
  });

  it('3. 記録時の地形に riverM（地図の河川までの距離）。沢の目安とは別の行で見せる', () => {
    const d = area(true);
    const p = gridToLatLng(d.manifest, 1.5, 1.5);
    const snap = snapshotFrom(d, p.lat, p.lng)!;
    expect(snap.riverM).toBeGreaterThan(1066);
    expect(snap.riverM).toBeLessThan(1086);
    const rows = terrainRows(snap, (id) => id);
    expect(rows.find((r) => r.label === '地図の河川')?.value).toBe('約1.1km');
    expect(rows.find((r) => r.label === '沢の目安')).toBeTruthy();
    // 河川の無い版では値を持たない（「—」）
    const s0 = snapshotFrom(area(false), p.lat, p.lng)!;
    expect('riverM' in s0).toBe(false);
    expect(terrainRows(s0, (id) => id).find((r) => r.label === '地図の河川')?.value).toBe('—');
  });

  it('4. 距離と表示', () => {
    expect(mapRiverDistanceM({ c: [], e: [] }, 43, 140)).toBeNull();
    expect(riverDistanceText(995)).toBe('約1.0km');
    expect(riverDistanceText(104)).toBe('約100m');
  });

  it('5. 沢の目安（DEM）は水色。地図の河川（濃紺）と色で分ける', () => {
    expect(STREAM_COLOR.slice(0, 3)).toEqual([79, 195, 247]);
  });
});
