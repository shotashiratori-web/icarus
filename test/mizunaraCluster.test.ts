import { describe, expect, it } from 'vitest';
import { forestFromPixels, parseForestJson } from '../src/terrain/forest';
import {
  CLUSTER_EDGE_COLOR, CLUSTER_HALO_COLOR, clusterAt, clusterSeed, clusterText, drawClusterOutline, mizunaraClusters,
} from '../src/terrain/mizunaraCluster';
import type { TerrainManifest } from '../src/terrain/types';

// ミズナラの群生の輪郭（icarus_mizunara_cluster_outline_v1_design.md）。
// 群生 = 森林計画 1〜3 位 × 植生図のミズナラ系群落。1 位だけにしない（初舞茸 = 2 位・余市西 = 3 位）

const json = {
  format: 'forest-v1',
  sources: { kokuyu: { name: '国有林', year: 2018 } },
  stands: [
    ['k', 2018, 'r1', [['ミズナラ', null]], 120, '天然生林', 1, 0, 1], // 1: 1 位
    ['k', 2018, 'r2', [['カンバ', null], ['ミズナラ', null]], 95, '天然生林', 2, 0, 1], // 2: 2 位（初舞茸の形）
    ['k', 2018, 'r3', [['カンバ', null], ['他Ｌ', null], ['ミズナラ', null]], 140, '天然生林', 3, 0, 1], // 3: 3 位（余市西の形）
    ['k', 2018, 'no', [['トドマツ', null]], 40, '人工林', 0, 3, 1], // 4: ミズナラなし
  ],
  veg: [['050100', 'シラカンバ－ミズナラ群落', 2022, true], ['999999', 'ササ群落', 2022, false]],
} as const;

// pxM = 100m → 1 格子 1ha。stand/veg を関数で決めて森林を作る
function make(w: number, h: number, at: (x: number, y: number) => [number, number]) {
  const rgba = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const [s, v] = at(x, y); const j = (y * w + x) * 4;
    rgba[j] = s >> 8; rgba[j + 1] = s & 255; rgba[j + 2] = v; rgba[j + 3] = 255;
  }
  const m = { grid: { width: w, height: h, pxM: 100 } } as unknown as TerrainManifest;
  return forestFromPixels(m, rgba, w, h, parseForestJson(json as never));
}
const inBox = (x: number, y: number, x0: number, y0: number, x1: number, y1: number) => x >= x0 && x <= x1 && y >= y0 && y <= y1;

describe('群生の元の格子', () => {
  it('1〜3 位 × ミズナラ系群落だけ。1 位だけにしない・群落でない所・ミズナラなしの林分は入らない', () => {
    const f = make(5, 1, (x) => [[1, 1], [2, 1], [3, 1], [4, 1], [2, 2]][x] as [number, number]);
    expect(Array.from(clusterSeed(f))).toEqual([1, 1, 1, 0, 0]);
  });
});

describe('塊の整え方', () => {
  it('2 位・3 位だけの塊でも出る（既知の大木の形）', () => {
    // 2 つの塊の間は 6 格子（つなぐ幅の 2 格子より広い）
    const f = make(24, 12, (x, y) => (inBox(x, y, 2, 2, 7, 7) ? [2, 1] : inBox(x, y, 14, 2, 19, 7) ? [3, 1] : [4, 2]));
    const c = mizunaraClusters(f, 100);
    expect(c.blocks.length).toBe(2);
    expect(clusterAt(c, 4 * 24 + 4)).not.toBeNull();
    expect(clusterAt(c, 4 * 24 + 16)).not.toBeNull();
  });

  it('2ha 未満の塊は出さない', () => {
    const f = make(12, 12, (x, y) => (x === 5 && y === 5 ? [1, 1] : [4, 2]));
    expect(mizunaraClusters(f, 100).blocks.length).toBe(0);
  });

  it('塊の中の 3ha 未満の穴は埋め、大きな穴は残す', () => {
    // 外枠 1〜22 の塊。中に 2×1（2ha）の穴と 10×10（100ha）の穴（つなぐ処理では埋まらない広さ）
    const f = make(24, 24, (x, y) => {
      if (!inBox(x, y, 1, 1, 22, 22)) return [4, 2];
      if (inBox(x, y, 3, 3, 4, 3)) return [4, 2]; // 小さい穴
      if (inBox(x, y, 8, 8, 17, 17)) return [4, 2]; // 大きい穴
      return [2, 1];
    });
    const c = mizunaraClusters(f, 100);
    expect(c.blocks.length).toBe(1);
    expect(clusterAt(c, 3 * 24 + 3)).not.toBeNull(); // 小さい穴は埋まる
    expect(clusterAt(c, 12 * 24 + 12)).toBeNull(); // 大きい穴は残る
  });

  it('2 格子の切れ目はつながって 1 つの塊になる', () => {
    const f = make(20, 10, (x, y) => (inBox(x, y, 1, 2, 8, 7) || inBox(x, y, 11, 2, 18, 7) ? [2, 1] : [4, 2]));
    expect(mizunaraClusters(f, 100).blocks.length).toBe(1);
  });

  it('面積は格子の面積（pxM²）から。ラベルの位置は塊の中', () => {
    const f = make(10, 10, (x, y) => (inBox(x, y, 2, 2, 7, 7) ? [1, 1] : [4, 2]));
    const c = mizunaraClusters(f, 50); // 1 格子 0.25ha。6×6 = 36 格子から、ひげを落とす処理で四隅が丸まって 32 格子 = 8ha
    expect(c.blocks).toHaveLength(1);
    expect(c.blocks[0].ha).toBe(8);
    const b = c.blocks[0];
    expect(clusterAt(c, b.labelY * 10 + b.labelX)?.id).toBe(b.id);
    expect(clusterText(b)).toBe('ミズナラの群生（森林計画 1〜3 位 × 植生図の群落）・8ha');
  });
});

describe('輪郭', () => {
  it('塊の縁は黄、すぐ外は白、中と遠い外は描かない', () => {
    const f = make(12, 12, (x, y) => (inBox(x, y, 3, 3, 8, 8) ? [2, 1] : [4, 2]));
    const c = mizunaraClusters(f, 100);
    const o = new Uint8ClampedArray(12 * 12 * 4);
    drawClusterOutline(c, o);
    const px = (x: number, y: number) => Array.from(o.slice((y * 12 + x) * 4, (y * 12 + x) * 4 + 4));
    expect(px(3, 5)).toEqual([...CLUSTER_EDGE_COLOR]);
    expect(px(2, 5)).toEqual([...CLUSTER_HALO_COLOR]);
    expect(px(5, 5)).toEqual([0, 0, 0, 0]);
    expect(px(0, 0)).toEqual([0, 0, 0, 0]);
  });
});
