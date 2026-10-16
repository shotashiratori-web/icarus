import type { ForestData } from './forest';

// ミズナラの群生の輪郭（icarus_mizunara_cluster_outline_v1_design.md）。
// 群生 = 森林計画でミズナラが 1〜3 位の林分 × 植生図のミズナラ系群落 が重なる格子（根拠が 2 つ重なる所）。
// 1 位を特別扱いしない（初舞茸 = 2 位・余市西の大ミズナラ = 3 位。1 位だけにすると 2 本とも外れる）。
// ミズナラの本数・割合ではない（国有林のデータに割合は無い）

export const CLUSTER_CLOSE_R = 2; // 細い切れ目をつなぐ（約 40m）
export const CLUSTER_HOLE_HA = 3; // 塊の中のこれ未満の穴を埋める（ミズナラの記録がない小さな林分）
export const CLUSTER_OPEN_R = 1; // 細いひげを落とす
export const CLUSTER_MIN_HA = 2; // これ未満の塊は出さない
export const CLUSTER_LABEL_MIN_HA = 5; // 面積のラベルを付ける塊

export interface ClusterBlock {
  id: number; // label の値（1 から）
  ha: number;
  labelX: number; // ラベルを置く格子（塊の中で、塊の中心に一番近い格子）
  labelY: number;
}
export interface MizunaraClusters {
  width: number;
  height: number;
  label: Uint32Array; // 格子ごとの塊の番号（0 = 塊の外）
  blocks: ClusterBlock[]; // blocks[id - 1]
}

const disk = (r: number): [number, number][] => {
  const o: [number, number][] = [];
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (dx * dx + dy * dy <= r * r) o.push([dx, dy]);
  return o;
};

// 外は 0 として扱う（膨張も収縮も）
function dilate(a: Uint8Array, w: number, h: number, se: [number, number][]): Uint8Array {
  const o = new Uint8Array(a.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!a[y * w + x]) continue;
      for (const [dx, dy] of se) {
        const xx = x + dx, yy = y + dy;
        if (xx >= 0 && yy >= 0 && xx < w && yy < h) o[yy * w + xx] = 1;
      }
    }
  }
  return o;
}
function erode(a: Uint8Array, w: number, h: number, se: [number, number][]): Uint8Array {
  const o = new Uint8Array(a.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!a[y * w + x]) continue;
      let all = true;
      for (const [dx, dy] of se) {
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= w || yy >= h || !a[yy * w + xx]) { all = false; break; }
      }
      if (all) o[y * w + x] = 1;
    }
  }
  return o;
}

// 連結成分。eight = 8 近傍（塊）／4 近傍（穴・外の背景）
function components(a: Uint8Array, w: number, h: number, eight: boolean): { label: Uint32Array; sizes: number[] } {
  const label = new Uint32Array(a.length);
  const sizes: number[] = [0];
  const stack = new Int32Array(a.length);
  const nb = eight ? [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]] : [[0, -1], [-1, 0], [1, 0], [0, 1]];
  for (let i = 0; i < a.length; i++) {
    if (!a[i] || label[i]) continue;
    const id = sizes.length;
    let sp = 0, n = 0;
    stack[sp++] = i;
    label[i] = id;
    while (sp) {
      const j = stack[--sp];
      n++;
      const x = j % w, y = (j - x) / w;
      for (const [dx, dy] of nb) {
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
        const k = yy * w + xx;
        if (a[k] && !label[k]) { label[k] = id; stack[sp++] = k; }
      }
    }
    sizes.push(n);
  }
  return { label, sizes };
}

// 群生の元になる格子（整える前）
export function clusterSeed(f: ForestData): Uint8Array {
  const n = f.width * f.height;
  const o = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const si = f.stand[i], vi = f.veg[i];
    if (!si || !vi) continue;
    const s = f.stands[si - 1], v = f.vegs[vi - 1];
    if (s && v && v.mizunara && s.mizunaraRank >= 1 && s.mizunaraRank <= 3) o[i] = 1;
  }
  return o;
}

const cache = new WeakMap<ForestData, MizunaraClusters>();

// pxM = 格子 1 つの一辺（m）。同じ森林データでは 1 回だけ計算する
export function mizunaraClusters(f: ForestData, pxM: number): MizunaraClusters {
  const hit = cache.get(f);
  if (hit) return hit;
  const w = f.width, h = f.height;
  const haPerCell = (pxM * pxM) / 10000;
  // 1. closing（細い切れ目をつなぐ）
  const se2 = disk(CLUSTER_CLOSE_R);
  let m = erode(dilate(clusterSeed(f), w, h, se2), w, h, se2);
  // 2. 塊の中の小さな穴を埋める（外の背景につながらない 0 の連結成分のうち、小さいもの）
  const bg = new Uint8Array(m.length);
  for (let i = 0; i < m.length; i++) bg[i] = m[i] ? 0 : 1;
  const holes = components(bg, w, h, false);
  const outside = new Set<number>();
  for (let x = 0; x < w; x++) { outside.add(holes.label[x]); outside.add(holes.label[(h - 1) * w + x]); }
  for (let y = 0; y < h; y++) { outside.add(holes.label[y * w]); outside.add(holes.label[y * w + w - 1]); }
  for (let i = 0; i < m.length; i++) {
    const id = holes.label[i];
    if (id && !outside.has(id) && holes.sizes[id] * haPerCell < CLUSTER_HOLE_HA) m[i] = 1;
  }
  // 3. opening（細いひげを落とす）
  const se1 = disk(CLUSTER_OPEN_R);
  m = dilate(erode(m, w, h, se1), w, h, se1);
  // 4. 小さな塊を落として番号を振り直す
  const c = components(m, w, h, true);
  const remap = new Uint32Array(c.sizes.length);
  const blocks: ClusterBlock[] = [];
  for (let id = 1; id < c.sizes.length; id++) {
    if (c.sizes[id] * haPerCell < CLUSTER_MIN_HA) continue;
    remap[id] = blocks.length + 1;
    blocks.push({ id: blocks.length + 1, ha: Math.round(c.sizes[id] * haPerCell), labelX: 0, labelY: 0 });
  }
  const label = new Uint32Array(m.length);
  const sx = new Float64Array(blocks.length + 1), sy = new Float64Array(blocks.length + 1), cnt = new Float64Array(blocks.length + 1);
  for (let i = 0; i < m.length; i++) {
    const id = remap[c.label[i]];
    if (!id) continue;
    label[i] = id;
    const x = i % w;
    sx[id] += x; sy[id] += (i - x) / w; cnt[id]++;
  }
  // ラベルの位置: 塊の中で、塊の中心に一番近い格子（中心が塊の外に出る形でも塊の上に置く）
  const best = new Float64Array(blocks.length + 1).fill(Infinity);
  for (let i = 0; i < m.length; i++) {
    const id = label[i];
    if (!id) continue;
    const x = i % w, y = (i - x) / w;
    const d = (x - sx[id] / cnt[id]) ** 2 + (y - sy[id] / cnt[id]) ** 2;
    if (d < best[id]) { best[id] = d; blocks[id - 1].labelX = x; blocks[id - 1].labelY = y; }
  }
  const out = { width: w, height: h, label, blocks };
  cache.set(f, out);
  return out;
}

// 輪郭: 塊の内側の縁（8 近傍に塊の外がある）を黄、そのすぐ外の 1 格子を白。中は塗らない（順位の塗りを残す）
export const CLUSTER_EDGE_COLOR = [255, 214, 0, 255] as const;
export const CLUSTER_HALO_COLOR = [255, 255, 255, 255] as const;
export function drawClusterOutline(c: MizunaraClusters, out: Uint8ClampedArray): void {
  const { width: w, height: h, label } = c;
  const isIn = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && label[y * w + x] !== 0;
  const edge = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!label[y * w + x]) continue;
      let border = false;
      for (let dy = -1; dy <= 1 && !border; dy++) for (let dx = -1; dx <= 1; dx++) if ((dx || dy) && !isIn(x + dx, y + dy)) { border = true; break; }
      if (border) edge[y * w + x] = 1;
    }
  }
  const put = (i: number, col: readonly number[]) => { const j = i * 4; out[j] = col[0]; out[j + 1] = col[1]; out[j + 2] = col[2]; out[j + 3] = col[3]; };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (edge[i]) { put(i, CLUSTER_EDGE_COLOR); continue; }
      if (label[i]) continue;
      // 外側の縁: 4 近傍に内側の縁がある塊の外の格子
      if ((x > 0 && edge[i - 1]) || (x < w - 1 && edge[i + 1]) || (y > 0 && edge[i - w]) || (y < h - 1 && edge[i + w])) put(i, CLUSTER_HALO_COLOR);
    }
  }
}

export const clusterAt = (c: MizunaraClusters, i: number): ClusterBlock | null => {
  const id = c.label[i];
  return id ? c.blocks[id - 1] : null;
};
export const clusterText = (b: ClusterBlock) => `ミズナラの群生（森林計画 1〜3 位 × 植生図の群落）・${b.ha}ha`;
