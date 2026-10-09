import type { EnvironmentSpot, EnvType, LifeState, ObsResult } from '../environmentSpots/types';
import { LIFE_LABEL, RESULT_LABEL, STAGE_LABEL } from '../environmentSpots/types';
import type { HydroGrid } from './hydro';
import { STREAM_COLOR, twiValue } from './hydro';
import { terrainRows, terrainState, type TerrainSnapshot } from './terrainSnapshot';
import type { TerrainManifest } from './types';

// 3D-2「Forest & Water Context」（読み取り専用）。設計: icarus_3d2_forest_water_context_audit.md
// 水は 1 つにまとめない: 地図の河川（地理院 1/25,000）／沢の目安（DEM の推定）／湿りやすさ（TWI）／現地で確認した水（地形の Spot）

type Percentiles = TerrainManifest['twiPercentiles'];

// TWI を山域の中での位置づけで言う（「上位 10%」の方が現場の感覚と結びつく）
export function twiRank(twi: number, p: Percentiles): string | null {
  if (!p) return null;
  if (twi > p['90']) return '湿潤・エリア上位10%';
  if (twi > p['67']) return 'やや湿潤・エリア上位33%';
  if (twi < p['33']) return '乾きやすい・エリア下位33%';
  return '中くらい';
}

// 林分の樹種を順位つきで（森林計画の並び順 = 多い順）。全角の「他Ｌ」なども半角へ
export function forestRanks(species: string[]): string {
  return species.map((s, i) => `${s.normalize('NFKC')}${i + 1}位`).join('・');
}

export interface InspectorObs {
  target: string;
  mark: '✓' | '×';
  result: string; // あり／なし
  date: string;
  stage: string | null;
  more: number; // 同じ対象のほかの観察（見ていないを除く）
}

export interface Inspector {
  title: string;
  pending: boolean; // この端末で未送信（詳細は送信後）
  tree: { dbh: string | null; decay: string | null; decayNote: string | null } | null; // null の値 = 未入力（「—」と薄く出す）
  firstSeen: string | null;
  obsCount: number; // 見ていないを含む観察の回数
  observations: InspectorObs[];
  forest: { ranks: string | null; veg: string | null } | null;
  terrain: string | null; // 谷 / 北西 / 11°
  water: { twi: string | null; stream: string | null } | null;
  terrainNote: string | null; // 地形が取れていない記録の説明（2D と同じ文言）
}

const ymd = (iso: string) => {
  const d = new Date(iso);
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
};

export interface InspectInput {
  label: string;
  envType: EnvType;
  lifeState: LifeState;
  remote: EnvironmentSpot | null;
  manifest: Pick<TerrainManifest, 'areaId' | 'twiPercentiles'>;
  areaName: (areaId: string) => string;
}

export function inspectSpot({ label, envType, lifeState, remote: s, manifest, areaName }: InspectInput): Inspector {
  const isTree = envType === 'tree';
  const title = isTree ? `${s?.treeSpecies ?? s?.treeSpeciesText ?? label.replace(/（.*$/, '')}（${LIFE_LABEL[lifeState]}）` : label;
  if (!s) return { title, pending: true, tree: null, firstSeen: null, obsCount: 0, observations: [], forest: null, terrain: null, water: null, terrainNote: null };

  const decayApplies = lifeState === 'snag' || lifeState === 'fallen'; // 腐朽度は立枯れ・倒木だけに付ける
  const tree = isTree ? {
    dbh: s.dbhCm ? `${s.dbhCm}cm` : null,
    decay: decayApplies && s.decayClass ? `${s.decayClass}（${['', '硬い', '一部腐朽', 'ぼろぼろ'][s.decayClass] ?? ''}）` : null,
    decayNote: decayApplies ? null : `対象外（${LIFE_LABEL[lifeState]}）`,
  } : null;

  const active = s.observations.filter((o) => o.status === 'active').sort((a, b) => a.observedAt.localeCompare(b.observedAt));
  const byTarget = new Map<string, typeof active>();
  for (const o of active) {
    if (o.result === 'not_checked') continue; // 見ていない = 無かったではない（結果には出さない）
    const k = o.targetSpeciesId ?? o.targetText ?? o.target;
    byTarget.set(k, [...(byTarget.get(k) ?? []), o]);
  }
  const observations: InspectorObs[] = [...byTarget.values()].map((list): InspectorObs => {
    const o = list[list.length - 1];
    const r = o.result as Exclude<ObsResult, 'not_checked'>;
    return { target: o.target || o.targetText, mark: r === 'found' ? '✓' : '×', result: RESULT_LABEL[r], date: ymd(o.observedAt), stage: r === 'found' && o.foundStage ? STAGE_LABEL[o.foundStage] : null, more: list.length - 1 };
  }).sort((a, b) => (a.mark === b.mark ? b.date.localeCompare(a.date) : a.mark === '✓' ? -1 : 1));

  const t = s.terrain as TerrainSnapshot | null;
  const ok = terrainState(t) === 'ok';
  let forest: Inspector['forest'] = null, terrain: string | null = null, water: Inspector['water'] = null, terrainNote: string | null = null;
  if (ok && t) {
    const fs = t.forestStand as { species?: string[] } | null | undefined;
    const vg = t.vegetation as { name?: string } | null | undefined;
    forest = { ranks: fs?.species?.length ? forestRanks(fs.species) : null, veg: vg?.name ?? null };
    terrain = [t.landform, t.aspect, t.slopeDeg !== undefined && t.slopeDeg !== null && `${String(t.slopeDeg)}°`].filter(Boolean).map(String).join(' / ') || null;
    // 位置づけは表示中の山域の分位（記録した山域が違う時は数値だけ）
    const sameArea = !t.areaId || t.areaId === manifest.areaId;
    const twi = typeof t.twi === 'number' ? t.twi : null;
    const rank = twi !== null && sameArea ? twiRank(twi, manifest.twiPercentiles) : null;
    water = {
      twi: twi === null ? null : `TWI ${twi.toFixed(1)}${rank ? `（${rank}）` : ''}`,
      // 2D と同じ文言（記録時の値）を使う。古い記録の「沢から約…」も「沢の目安」と呼ぶ（地図の河川と混ぜない）
      stream: typeof t.stream === 'string' ? String(t.stream).replace(/^沢(の目安)?から/, '沢の目安 ') : typeof t.streamM === 'number' ? `沢の目安 約${Math.round(t.streamM / 10) * 10}m` : null,
    };
  } else if (terrainState(t) !== 'none') {
    terrainNote = terrainRows(t, areaName)[0].value;
  }
  return { title, pending: false, tree, firstSeen: s.observedAt ? ymd(s.observedAt) : null, obsCount: active.length, observations, forest, terrain, water, terrainNote };
}

// ---- 3D に重ねる画像（パッケージの値から作る。2D は変えない） ----
export const TWI_COLOR: [number, number, number] = [0, 137, 123];
export const DEM_STREAM_COLOR = STREAM_COLOR; // 2D と同じ水色（地図の河川の濃紺と分ける）

// 湿りやすさ: 上位 10% は濃く、上位 33% は薄く
export function renderTwi(m: TerrainManifest, h: HydroGrid, out: Uint8ClampedArray): boolean {
  out.fill(0);
  const p = m.twiPercentiles;
  if (!p) return false;
  for (let i = 0; i < h.width * h.height; i++) {
    if (h.landform[i] === 0) continue; // 海・範囲外
    const v = twiValue(m, h.twiLevel[i]);
    const a = v > p['90'] ? 120 : v > p['67'] ? 50 : 0;
    if (!a) continue;
    const j = i * 4;
    out[j] = TWI_COLOR[0]; out[j + 1] = TWI_COLOR[1]; out[j + 2] = TWI_COLOR[2]; out[j + 3] = a;
  }
  return true;
}

export function renderDemStreams(h: HydroGrid, out: Uint8ClampedArray): void {
  out.fill(0);
  for (let i = 0; i < h.width * h.height; i++) {
    if (h.streamDist[i] !== 0 || h.landform[i] === 0) continue;
    const j = i * 4;
    out[j] = DEM_STREAM_COLOR[0]; out[j + 1] = DEM_STREAM_COLOR[1]; out[j + 2] = DEM_STREAM_COLOR[2]; out[j + 3] = DEM_STREAM_COLOR[3];
  }
}
