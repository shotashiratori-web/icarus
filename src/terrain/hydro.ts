import type { TerrainManifest } from './types';

// DEM 由来の地形（Species Exploration / Maitake v1 S2）。build_area.py の hydro.py が作る terrain2.png:
// R = 方位（0–254 = 0–360°、255 = 平坦・海）、G = 沢からの距離（格子数、255 = 遠い）、
// B = (湿潤度 TWI の段階 0–31) << 3 | 斜面の位置（0 = 海、1 尾根・2 上部斜面（肩の目安）・3 中腹・4 平坦・5 下部斜面・6 谷）

export interface HydroGrid {
  width: number;
  height: number;
  aspect: Uint8Array;
  streamDist: Uint8Array;
  twiLevel: Uint8Array;
  landform: Uint8Array;
}

export const LANDFORMS = [
  { id: 1, label: '尾根' },
  { id: 2, label: '上部斜面（肩の目安・試験的）' },
  { id: 3, label: '中腹' },
  { id: 4, label: '平坦' },
  { id: 5, label: '下部斜面' },
  { id: 6, label: '谷' },
] as const;

export const DIRECTIONS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'] as const;
export type Direction = (typeof DIRECTIONS)[number];
export const DIRECTION_LABEL: Record<Direction, string> = { N: '北', NE: '北東', E: '東', SE: '南東', S: '南', SW: '南西', W: '西', NW: '北西' };

export function hydroFromPixels(m: TerrainManifest, rgba: Uint8ClampedArray, width: number, height: number): HydroGrid {
  if (width !== m.grid.width || height !== m.grid.height) throw new Error('地形（terrain2）の大きさが manifest と一致しません');
  const n = width * height;
  const aspect = new Uint8Array(n), streamDist = new Uint8Array(n), twiLevel = new Uint8Array(n), landform = new Uint8Array(n);
  for (let i = 0, j = 0; i < n; i++, j += 4) {
    aspect[i] = rgba[j];
    streamDist[i] = rgba[j + 1];
    twiLevel[i] = rgba[j + 2] >> 3;
    landform[i] = rgba[j + 2] & 7;
  }
  return { width, height, aspect, streamDist, twiLevel, landform };
}

export const aspectDeg = (v: number): number | null => (v === 255 ? null : (v / 254) * 360);

// 8 方位（北 = 337.5〜22.5°）
export function directionOf(deg: number): Direction {
  return DIRECTIONS[Math.round(deg / 45) % 8];
}

export function twiValue(m: TerrainManifest, level: number): number {
  const lo = Number(m.params.twi_min ?? 2), hi = Number(m.params.twi_max ?? 18);
  return lo + (level / 31) * (hi - lo);
}

export type Wetness = 'low' | 'mid' | 'high';
export const WETNESS_LABEL: Record<Wetness, string> = { low: '乾きやすい', mid: '中くらい', high: '湿りやすい' };

// 利用範囲の陸地の 3 分位で分ける（manifest.twiPercentiles）
export function wetnessOf(m: TerrainManifest, level: number): Wetness {
  const v = twiValue(m, level);
  const p = m.twiPercentiles;
  if (!p) return 'mid';
  return v < p['33'] ? 'low' : v > p['67'] ? 'high' : 'mid';
}

// ---- 地形の条件（S2）: 条件どうしは AND、1 つの条件の中の選択肢は OR。何も選ばなければ条件なし ----
export interface TerrainConditions {
  directions: Direction[];
  landforms: number[];
  wetness: Wetness[];
  streamWithinM: number | null; // 沢から ○m 以内
  streamBeyondM: number | null; // 沢から ○m 以上離れる
}

export const NO_TERRAIN_CONDITIONS: TerrainConditions = { directions: [], landforms: [], wetness: [], streamWithinM: null, streamBeyondM: null };

export const anyTerrainCondition = (c: TerrainConditions) =>
  c.directions.length > 0 || c.landforms.length > 0 || c.wetness.length > 0 || c.streamWithinM !== null || c.streamBeyondM !== null;

export function matchTerrain(m: TerrainManifest, h: HydroGrid, i: number, c: TerrainConditions): boolean {
  if (h.landform[i] === 0) return false; // 海・データなし
  if (c.directions.length) {
    const d = aspectDeg(h.aspect[i]);
    if (d === null || !c.directions.includes(directionOf(d))) return false;
  }
  if (c.landforms.length && !c.landforms.includes(h.landform[i])) return false;
  if (c.wetness.length && !c.wetness.includes(wetnessOf(m, h.twiLevel[i]))) return false;
  const px = m.grid.pxM;
  const dist = h.streamDist[i] === 255 ? Infinity : h.streamDist[i] * px;
  if (c.streamWithinM !== null && !(dist <= c.streamWithinM)) return false;
  if (c.streamBeyondM !== null && !(dist >= c.streamBeyondM)) return false;
  return true;
}

// 地形の条件に合う範囲は点（ドット）で塗る（森林の塗りと重ねても両方読めるように）。沢の線は青
export const TERRAIN_MATCH_COLOR: [number, number, number, number] = [255, 111, 0, 235];
export const STREAM_COLOR: [number, number, number, number] = [25, 118, 210, 230];

export function renderHydro(m: TerrainManifest, h: HydroGrid, c: TerrainConditions, showStreams: boolean, out?: Uint8ClampedArray): { image: Uint8ClampedArray; matchCells: number } {
  const o = out ?? new Uint8ClampedArray(h.width * h.height * 4);
  o.fill(0);
  const cond = anyTerrainCondition(c);
  let matchCells = 0;
  for (let y = 0; y < h.height; y++) {
    for (let x = 0; x < h.width; x++) {
      const i = y * h.width + x;
      let col: [number, number, number, number] | null = null;
      if (cond && matchTerrain(m, h, i, c)) {
        matchCells++;
        if (x % 2 === 0 && y % 2 === 0) col = TERRAIN_MATCH_COLOR;
      }
      if (showStreams && h.streamDist[i] === 0 && h.landform[i] !== 0) col = STREAM_COLOR;
      if (col) {
        const j = i * 4;
        o[j] = col[0]; o[j + 1] = col[1]; o[j + 2] = col[2]; o[j + 3] = col[3];
      }
    }
  }
  return { image: o, matchCells };
}

export function describeHydro(m: TerrainManifest, h: HydroGrid, i: number): string[] {
  if (h.landform[i] === 0) return [];
  const d = aspectDeg(h.aspect[i]);
  const lf = LANDFORMS.find((l) => l.id === h.landform[i])?.label ?? '—';
  const sd = h.streamDist[i];
  const stream = sd === 0 ? '沢の上' : sd === 255 ? '沢から約1.2km以上' : `沢から約${Math.round((sd * m.grid.pxM) / 10) * 10}m`;
  const tw = twiValue(m, h.twiLevel[i]);
  return [
    `方位 ${d === null ? '平坦' : `${DIRECTION_LABEL[directionOf(d)]}（${Math.round(d)}°）`}・斜面の位置 ${lf}`,
    `${stream}・湿潤度 ${WETNESS_LABEL[wetnessOf(m, h.twiLevel[i])]}（TWI ${tw.toFixed(1)}）`,
  ];
}

// ---- 選択中の条件を短くまとめる（パネル上部に出す。S4 で森林・探索実績と組み合わせても何を選んでいるか分かるように） ----
const LANDFORM_SHORT: Record<number, string> = { 1: '尾根', 2: '上部斜面', 3: '中腹', 4: '平坦', 5: '下部斜面', 6: '谷' };
const WETNESS_SHORT: Record<Wetness, string> = { low: '乾燥', mid: '中', high: '湿潤' };

// 方位: 時計回りに連続していれば「南〜西」、飛び飛びなら「北・南」。8 方位すべてなら条件なしと同じなので「全方位」
export function summarizeDirections(ds: Direction[]): string {
  if (ds.length === 0) return '';
  if (ds.length === 8) return '全方位';
  const on = DIRECTIONS.map((d) => ds.includes(d));
  // 連続した区間を、選ばれていない方位の直後から時計回りに集める
  const start = on.findIndex((v, i) => v && !on[(i + 7) % 8]);
  const runs: Direction[][] = [];
  for (let k = 0; k < 8; k++) {
    const i = (start + k) % 8;
    if (!on[i]) continue;
    if (!on[(i + 7) % 8] || runs.length === 0) runs.push([]);
    runs[runs.length - 1].push(DIRECTIONS[i]);
  }
  return runs.map((r) => (r.length >= 3 ? `${DIRECTION_LABEL[r[0]]}〜${DIRECTION_LABEL[r[r.length - 1]]}` : r.map((d) => DIRECTION_LABEL[d]).join('・'))).join('・');
}

export function summarizeTerrain(c: TerrainConditions): string {
  const parts: string[] = [];
  const d = summarizeDirections(c.directions);
  if (d) parts.push(d);
  if (c.landforms.length) parts.push([...c.landforms].sort().map((l) => LANDFORM_SHORT[l]).join('・'));
  if (c.wetness.length) parts.push((['low', 'mid', 'high'] as Wetness[]).filter((w) => c.wetness.includes(w)).map((w) => WETNESS_SHORT[w]).join('・'));
  if (c.streamWithinM !== null) parts.push(`沢から${c.streamWithinM}m以内`);
  if (c.streamBeyondM !== null) parts.push(`沢から${c.streamBeyondM}m以上`);
  return parts.join(' / ');
}
