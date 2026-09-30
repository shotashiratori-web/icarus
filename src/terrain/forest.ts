import type { TerrainManifest } from './types';

// 森林レイヤー（Species Exploration / Maitake v1 S1）。build_area.py の forest.py が作る。
// forest.png: R・G = 林分番号（16 bit、0 = なし）、B = 植生番号（0 = なし）。forest.json: 林分の表・植生の表・出典。
// 林分の区分（class）とミズナラの順位はパイプラインで決めた値をそのまま使い、ここで樹種から推論し直さない。
// 「天然林広葉樹（樹種不明）」はミズナラの条件に入れない（設計 §13-3）

export type ForestOwner = 'k' | 'm'; // 国有林・民有林
export const FOREST_CLASS = { other: 0, broadleafUnknown: 1, larch: 2, todo: 3, noRegister: 4 } as const;

export interface ForestStand {
  owner: ForestOwner;
  year: number;
  name: string;
  species: [string, number | null][];
  age: number | null;
  type: string | null;
  mizunaraRank: 0 | 1 | 2 | 3;
  cls: number;
}

export interface ForestVeg {
  code: string;
  name: string;
  year: number | null;
  mizunara: boolean;
}

export interface ForestData {
  width: number;
  height: number;
  stand: Uint16Array; // 格子ごとの林分番号
  veg: Uint8Array; // 格子ごとの植生番号
  stands: ForestStand[]; // stands[番号 - 1]
  vegs: ForestVeg[];
  sources: Record<string, { name: string; year?: number; years?: [number, number] | null }>;
}

interface ForestJson {
  format: string;
  sources: ForestData['sources'];
  stands: [ForestOwner, number, string, [string, number | null][], number | null, string | null, number, number, number | null][];
  veg: [string, string, number | null, boolean][];
}

export function parseForestJson(j: ForestJson): Pick<ForestData, 'stands' | 'vegs' | 'sources'> {
  if (j.format !== 'forest-v1') throw new Error(`森林データの形式に対応していません（${j.format}）`);
  return {
    stands: j.stands.map((s) => ({ owner: s[0], year: s[1], name: s[2], species: s[3], age: s[4], type: s[5], mizunaraRank: s[6] as ForestStand['mizunaraRank'], cls: s[7] })),
    vegs: j.veg.map((v) => ({ code: v[0], name: v[1], year: v[2], mizunara: v[3] })),
    sources: j.sources,
  };
}

// RGBA（forest.png をそのまま読んだもの）→ 番号の配列
export function forestFromPixels(m: TerrainManifest, rgba: Uint8ClampedArray, width: number, height: number, meta: Pick<ForestData, 'stands' | 'vegs' | 'sources'>): ForestData {
  if (width !== m.grid.width || height !== m.grid.height) throw new Error('森林データの大きさが manifest と一致しません');
  const n = width * height;
  const stand = new Uint16Array(n);
  const veg = new Uint8Array(n);
  for (let i = 0, j = 0; i < n; i++, j += 4) {
    stand[i] = (rgba[j] << 8) | rgba[j + 1];
    veg[i] = rgba[j + 2];
  }
  return { width, height, stand, veg, ...meta };
}

// ---- 表示するレイヤー（すべて独立。1〜3 位を 1 色に潰さない） ----
export interface ForestLayers {
  mz1: boolean;
  mz2: boolean;
  mz3: boolean;
  kokuyuNoMizunara: boolean;
  broadleafUnknown: boolean;
  larch: boolean;
  todo: boolean;
  vegMizunara: string[]; // 表示するミズナラ系の群落名
  vegOther: boolean;
}

export const NO_FOREST_LAYERS: ForestLayers = {
  mz1: false, mz2: false, mz3: false, kokuyuNoMizunara: false, broadleafUnknown: false, larch: false, todo: false, vegMizunara: [], vegOther: false,
};

export const anyForestLayer = (l: ForestLayers) =>
  l.mz1 || l.mz2 || l.mz3 || l.kokuyuNoMizunara || l.broadleafUnknown || l.larch || l.todo || l.vegOther || l.vegMizunara.length > 0;

type RGBA = [number, number, number, number];
export const FOREST_COLORS: Record<'mz1' | 'mz2' | 'mz3' | 'kokuyuNoMizunara' | 'broadleafUnknown' | 'larch' | 'todo' | 'vegOther', RGBA> = {
  mz1: [20, 83, 45, 210], // 濃い緑
  mz2: [56, 142, 60, 200],
  mz3: [129, 199, 132, 190], // 薄い緑
  kokuyuNoMizunara: [176, 190, 197, 150],
  broadleafUnknown: [188, 170, 164, 110], // 薄く（樹種不明）
  larch: [212, 165, 55, 190],
  todo: [60, 130, 150, 190],
  vegOther: [96, 125, 139, 150],
};
// ミズナラ系の群落は斜線（林分の塗りと重ねても両方読めるように）。群落ごとに色を変える
export const VEG_MIZUNARA_PALETTE: RGBA[] = [[123, 31, 162, 235], [194, 24, 91, 235], [21, 101, 192, 235], [0, 121, 107, 235], [230, 81, 0, 235]];

export function mizunaraCommunities(f: Pick<ForestData, 'vegs'>): string[] {
  return [...new Set(f.vegs.filter((v) => v.mizunara).map((v) => v.name))];
}

export function vegColor(names: string[], name: string): RGBA {
  const k = names.indexOf(name);
  return VEG_MIZUNARA_PALETTE[(k < 0 ? 0 : k) % VEG_MIZUNARA_PALETTE.length];
}

// 画像（格子 1 つ = 1 画素）。斜線は 4 格子おき
export function renderForest(f: ForestData, l: ForestLayers, out?: Uint8ClampedArray): Uint8ClampedArray {
  const o = out ?? new Uint8ClampedArray(f.width * f.height * 4);
  o.fill(0);
  const communities = mizunaraCommunities(f);
  const vegShow = f.vegs.map((v) => (v.mizunara ? l.vegMizunara.includes(v.name) : l.vegOther));
  const vegCol = f.vegs.map((v) => (v.mizunara ? vegColor(communities, v.name) : FOREST_COLORS.vegOther));
  for (let y = 0; y < f.height; y++) {
    for (let x = 0; x < f.width; x++) {
      const i = y * f.width + x;
      let c: RGBA | null = null;
      const si = f.stand[i];
      if (si) {
        const s = f.stands[si - 1];
        if (s) {
          const r = s.mizunaraRank;
          if (r === 1 && l.mz1) c = FOREST_COLORS.mz1;
          else if (r === 2 && l.mz2) c = FOREST_COLORS.mz2;
          else if (r === 3 && l.mz3) c = FOREST_COLORS.mz3;
          // 重なる時は ミズナラの順位 → 林の種類 → 国有林ミズナラなし の順（具体的な方を見せる）
          if (!c) {
            if (s.cls === FOREST_CLASS.broadleafUnknown && l.broadleafUnknown) c = FOREST_COLORS.broadleafUnknown;
            else if (s.cls === FOREST_CLASS.larch && l.larch) c = FOREST_COLORS.larch;
            else if (s.cls === FOREST_CLASS.todo && l.todo) c = FOREST_COLORS.todo;
            else if (r === 0 && s.owner === 'k' && s.cls !== FOREST_CLASS.noRegister && l.kokuyuNoMizunara) c = FOREST_COLORS.kokuyuNoMizunara;
          }
        }
      }
      const vi = f.veg[i];
      if (vi && vegShow[vi - 1]) {
        const v = f.vegs[vi - 1];
        if (v.mizunara ? (x + y) % 4 === 0 : !c) c = vegCol[vi - 1]; // ミズナラ系は斜線、その他は下地（林分の塗りが無い所だけ）
      }
      if (c) {
        const j = i * 4;
        o[j] = c[0]; o[j + 1] = c[1]; o[j + 2] = c[2]; o[j + 3] = c[3];
      }
    }
  }
  return o;
}

// ---- 地点情報（データの年を必ず付ける） ----
const OWNER_LABEL: Record<ForestOwner, string> = { k: '国有林', m: '民有林' };
// 国有林の森林調査簿の略号（表示だけ言い換える。データは変えない）
const SPECIES_LABEL: Record<string, string> = { '他Ｌ': 'その他広葉樹', '他Ｎ': 'その他針葉樹', '他L': 'その他広葉樹', '他N': 'その他針葉樹' };

export function describeForest(f: ForestData, i: number): string[] {
  const lines: string[] = [];
  const si = f.stand[i];
  const s = si ? f.stands[si - 1] : null;
  if (s) {
    const sp = s.species.length
      ? s.species.map(([n, r], k) => `${k + 1}位 ${SPECIES_LABEL[n] ?? n}${r ? `（${r}割）` : ''}`).join('・')
      : '樹種の記録なし';
    lines.push(`森林計画（${OWNER_LABEL[s.owner]} ${s.year}時点）: ${sp}${s.age ? `／林齢 ${s.age}` : ''}${s.type ? `／${s.type}` : ''}`);
    if (s.cls === FOREST_CLASS.broadleafUnknown) lines.push('天然林広葉樹は樹種不明（ミズナラかどうか分からない）');
  } else {
    lines.push('森林計画: 林分の記録なし');
  }
  const vi = f.veg[i];
  const v = vi ? f.vegs[vi - 1] : null;
  lines.push(v ? `植生図（${v.year ?? '年不明'}調査）: ${v.name}` : '植生図: 記録なし');
  return lines;
}

// 地点情報の見出し（樹種を一番上に大きく）: 樹種 1〜3 位・出どころと年・林齢・林種、植生（調査年）
export interface ForestHeadline {
  species: string | null; // 例: 1位 ミズナラ・2位 その他広葉樹・3位 イタヤカエデ
  note: string | null; // 例: 森林計画（国有林 2018時点・林齢105・天然生林）
  vegetation: string | null; // 例: エゾイタヤ－ミズナラ群落（2022調査）
}

export function forestHeadline(f: ForestData, i: number): ForestHeadline {
  const si = f.stand[i];
  const s = si ? f.stands[si - 1] : null;
  const vi = f.veg[i];
  const v = vi ? f.vegs[vi - 1] : null;
  let species: string | null = null;
  let note: string | null = null;
  if (s) {
    species = s.cls === FOREST_CLASS.broadleafUnknown
      ? '天然林広葉樹（樹種不明）'
      : s.species.length ? s.species.map(([n, r], k) => `${k + 1}位 ${SPECIES_LABEL[n] ?? n}${r ? `（${r}割）` : ''}`).join('・') : '樹種の記録なし';
    note = `森林計画（${OWNER_LABEL[s.owner]} ${s.year}時点${s.age ? `・林齢${s.age}` : ''}${s.type ? `・${s.type}` : ''}）`;
  }
  return { species, note, vegetation: v ? `${v.name}（${v.year ?? '年不明'}調査）` : null };
}

// 面積（ha）: 表示中のレイヤーの広さの目安
export function forestAreaHa(f: ForestData, pxM: number, pred: (s: ForestStand | null, v: ForestVeg | null) => boolean): number {
  let n = 0;
  for (let i = 0; i < f.stand.length; i++) {
    const si = f.stand[i];
    const vi = f.veg[i];
    if (pred(si ? f.stands[si - 1] : null, vi ? f.vegs[vi - 1] : null)) n++;
  }
  return Math.round((n * pxM * pxM) / 1e4);
}
