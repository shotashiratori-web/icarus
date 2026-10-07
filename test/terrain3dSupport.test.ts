import { describe, expect, it } from 'vitest';
import { assetManifestFiles } from '../build/assetManifest';
import { canShow3D, gsiToTerrarium, terrariumHeight } from '../src/terrain/gsiDem';

// 3D（PC だけ、icarus_3d_terrain_view_technical_audit.md §8）: 標高の変換・出してよい端末・iPhone に保存させない

describe('地理院の標高 → Terrarium', () => {
  const px = (r: number, g: number, b: number) => new Uint8ClampedArray([r, g, b, 255]);
  it('1. 正の標高（308.62m）・海や欠損（無効値）は 0m・負の標高', () => {
    const a = px(0, 120, 142); // 3D-0 で読んだ初舞茸付近の値 308.62m
    gsiToTerrarium(a);
    expect(terrariumHeight(a[0], a[1], a[2])).toBeCloseTo(308.62, 1);
    const sea = px(128, 0, 0); // 2^23 = 無効値
    gsiToTerrarium(sea);
    expect(terrariumHeight(sea[0], sea[1], sea[2])).toBeCloseTo(0, 5);
    const neg = px(255, 255, 156); // 2^24 - 100 → -1.00m
    gsiToTerrarium(neg);
    expect(terrariumHeight(neg[0], neg[1], neg[2])).toBeCloseTo(-1, 1);
  });
});

describe('3D を出してよい端末', () => {
  const mm = (pc: boolean) => () => ({ matches: pc });
  it('2. PC（細かいポインタ・幅 900px 以上）かつ WebGL2 の時だけ', () => {
    expect(canShow3D({ matchMedia: mm(true), webgl2: true })).toBe(true);
    expect(canShow3D({ matchMedia: mm(false), webgl2: true })).toBe(false); // iPhone
    expect(canShow3D({ matchMedia: mm(true), webgl2: false })).toBe(false);
    expect(canShow3D({ webgl2: true })).toBe(false);
  });
});

describe('asset-manifest（端末に保存する一覧）', () => {
  it('3. 3D の画面・MapLibre・その worker は外し、ほかは今までどおり', () => {
    expect(assetManifestFiles([
      'index.html', 'assets/index-A1.js', 'assets/ExplorationMap-B2.js', 'assets/Terrain3DView-C3.js', 'assets/Terrain3DView-C3.css',
      'assets/maplibre-gl-D4.js', 'assets/maplibre-gl-worker-E5.mjs', 'assets/react-F6.js',
    ])).toEqual(['assets/ExplorationMap-B2.js', 'assets/index-A1.js', 'assets/react-F6.js']);
  });
});
