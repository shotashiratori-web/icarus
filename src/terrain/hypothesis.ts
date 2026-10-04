import { compileConditions, isCandidateRaw, latLngToGrid, type ExplorationConditions } from './engine';
import { matchTerrain, type HydroGrid, type TerrainConditions } from './hydro';
import type { ForestData } from './forest';
import { isGroup, membersOf, standRanks } from './forestSpecies';
import { STATE_CODE, type ExplorationState, type TargetExploration } from './targetExploration';
import type { TerrainGrid, TerrainManifest } from './types';

// 仮説（S4 §3・§4）: 利用者が選んだ条件の AND。グループの中は「どれか」（OR）、グループどうしは「すべて」（AND）。
// 点数・確率は出さない。森林計画・植生図・現地確認は別のグループ（重なりを自動で足さない）。
// 「ミズナラ系群落」は群落であってミズナラそのものではない（表示でもそう書く）

export const HYPOTHESIS_SCHEMA = 'icarus.hypothesis/v1';

export type MizunaraRank = 1 | 2 | 3;
export interface ForestPlanCondition { species: string; ranks: MizunaraRank[]; members?: string[] }
interface LegacyForestPlan { mizunaraRanks: MizunaraRank[] }

// 森林計画の条件を今の形にそろえる（古い形はミズナラ）
export function forestPlanOf(fp: HypothesisConditions['forestPlan']): ForestPlanCondition | null {
  if (!fp) return null;
  if ('mizunaraRanks' in fp) return { species: 'ミズナラ', ranks: fp.mizunaraRanks };
  return fp;
}

export interface HypothesisConditions {
  // 森林計画（小班の樹種 1〜3 位）。species は個別種の表示名かグループ名（カンバ類など）、members はグループの中身（保存時点）。
  // 2026-10-04 より前の仮説は { mizunaraRanks } の形（ミズナラとして読む）
  forestPlan: ForestPlanCondition | LegacyForestPlan | null;
  vegetation: { communities: string[] } | null; // 植生図のミズナラ系群落（群落名）
  confirmedTrees: { treeSpeciesId: string; treeName: string; withinM: number } | null; // 環境スポット（現地確認の木）から ○m 以内
  terrain: { candidate: ExplorationConditions | null; dem: TerrainConditions | null } | null;
  exploration: { states: ExplorationState[]; lastExploredBeforeMonths: number | null } | null;
  access: { roadWithinM: number | null; trailWithinM: number | null } | null; // どちらか（OR）
}

export const NO_HYPOTHESIS_CONDITIONS: HypothesisConditions = {
  forestPlan: null, vegetation: null, confirmedTrees: null, terrain: null, exploration: null, access: null,
};

export type GroupId = keyof HypothesisConditions;
export const GROUP_LABEL: Record<GroupId, string> = {
  forestPlan: '森林計画', vegetation: '植生図', confirmedTrees: '現地確認', terrain: '地形', exploration: '探索実績', access: 'アクセス',
};
const GROUPS: GroupId[] = ['forestPlan', 'vegetation', 'confirmedTrees', 'terrain', 'exploration', 'access'];

// 空のグループは null にそろえる（「使っていない」と「空の条件」を区別して保存するため）
export function normalizeConditions(c: HypothesisConditions): HypothesisConditions {
  const terrain = c.terrain && (c.terrain.candidate || c.terrain.dem) ? c.terrain : null;
  return {
    forestPlan: (() => {
      const fp = forestPlanOf(c.forestPlan);
      if (!fp || !fp.species || !fp.ranks.length) return null;
      return { species: fp.species, ranks: [...fp.ranks].sort(), ...(isGroup(fp.species) ? { members: membersOf(fp.species) } : {}) };
    })(),
    vegetation: c.vegetation && c.vegetation.communities.length ? { communities: [...c.vegetation.communities].sort() } : null,
    confirmedTrees: c.confirmedTrees,
    terrain,
    exploration: c.exploration && (c.exploration.states.length || c.exploration.lastExploredBeforeMonths !== null) ? c.exploration : null,
    access: c.access && (c.access.roadWithinM !== null || c.access.trailWithinM !== null) ? c.access : null,
  };
}

export const activeGroups = (c: HypothesisConditions): GroupId[] => GROUPS.filter((g) => c[g] !== null);

export interface MatchContext {
  m: TerrainManifest;
  grid: TerrainGrid;
  forest: ForestData | null;
  hydro: HydroGrid | null;
  te: TargetExploration | null;
  trees: { lat: number; lng: number; treeSpeciesId: string | null }[];
  today: Date;
}

export interface CompiledHypothesis {
  groups: GroupId[];
  test: (i: number) => Record<GroupId, boolean | null>; // null = 使っていないグループ
  match: (i: number) => boolean;
  missing: GroupId[]; // データが無く判定できないグループ（その版の地形パッケージに森林・地形2が無いなど）
}

export function compileHypothesis(ctx: MatchContext, raw: HypothesisConditions): CompiledHypothesis {
  const c = normalizeConditions(raw);
  const { m, grid, forest, hydro, te } = ctx;
  const groups = activeGroups(c);
  const missing: GroupId[] = [];
  const px = m.grid.pxM;

  const fpc = forestPlanOf(c.forestPlan);
  const ranks = new Set(fpc?.ranks ?? []);
  const fpRanks = fpc && forest ? standRanks(forest, fpc.species) : null;
  const comms = new Set(c.vegetation?.communities ?? []);
  if ((c.forestPlan || c.vegetation) && !forest) missing.push(...groups.filter((g) => g === 'forestPlan' || g === 'vegetation'));

  let treeMask: Uint8Array | null = null;
  if (c.confirmedTrees) {
    const W = m.grid.width, H = m.grid.height;
    treeMask = new Uint8Array(W * H);
    const R = Math.max(0.5, c.confirmedTrees.withinM / px);
    const Ri = Math.ceil(R);
    for (const t of ctx.trees) {
      if (t.treeSpeciesId !== c.confirmedTrees.treeSpeciesId) continue;
      const g = latLngToGrid(m, t.lat, t.lng);
      const cx = Math.floor(g.x), cy = Math.floor(g.y);
      for (let dy = -Ri; dy <= Ri; dy++) {
        const Y = cy + dy;
        if (Y < 0 || Y >= H) continue;
        for (let dx = -Ri; dx <= Ri; dx++) {
          const X = cx + dx;
          if (X >= 0 && X < W && dx * dx + dy * dy <= R * R) treeMask[Y * W + X] = 1;
        }
      }
    }
  }

  const cc = c.terrain?.candidate ? compileConditions(m, c.terrain.candidate) : null;
  if (c.terrain?.dem && !hydro) missing.push('terrain');

  const states = new Set((c.exploration?.states ?? []).map((s) => STATE_CODE[s]));
  const beforeMonths = c.exploration?.lastExploredBeforeMonths ?? null;
  const cutoffDay = beforeMonths === null ? null : (() => {
    const d = new Date(ctx.today);
    d.setMonth(d.getMonth() - beforeMonths);
    return Math.floor(d.getTime() / 86400000);
  })();
  if (c.exploration && !te) missing.push('exploration');

  const roadMax = c.access?.roadWithinM ?? null;
  const trailMax = c.access?.trailWithinM ?? null;

  // グループごとの判定（描画で 200 万格子を回すので、格子ごとにオブジェクトを作らない）
  const preds: Partial<Record<GroupId, (i: number) => boolean>> = {};
  if (c.forestPlan) preds.forestPlan = (i) => {
    const s = forest && forest.stand[i] ? forest.stands[forest.stand[i] - 1] : null;
    return !!s && !!fpRanks && ranks.has(fpRanks[forest!.stand[i] - 1] as MizunaraRank);
  };
  if (c.vegetation) preds.vegetation = (i) => {
    const v = forest && forest.veg[i] ? forest.vegs[forest.veg[i] - 1] : null;
    return !!v && comms.has(v.name);
  };
  if (treeMask) preds.confirmedTrees = (i) => treeMask![i] === 1;
  if (c.terrain) {
    const dem = c.terrain.dem;
    preds.terrain = (i) => (!cc || isCandidateRaw(grid, i, cc)) && (!dem || (!!hydro && matchTerrain(m, hydro, i, dem)));
  }
  if (c.exploration) preds.exploration = (i) => {
    if (!te) return false;
    if (states.size && !states.has(te.state[i])) return false;
    if (cutoffDay !== null && !(te.lastDay[i] === 0 || te.lastDay[i] < cutoffDay)) return false; // 未探索も「○か月以上前」に含める
    return true;
  };
  if (c.access) preds.access = (i) => {
    const j = i * 4;
    const road = grid.access[j] === 255 ? Infinity : grid.access[j] * px;
    const trail = grid.access[j + 1] === 255 ? Infinity : grid.access[j + 1] * px;
    return (roadMax !== null && road <= roadMax) || (trailMax !== null && trail <= trailMax);
  };
  const list = groups.map((g) => preds[g]!);

  const test = (i: number): Record<GroupId, boolean | null> => {
    const r = { forestPlan: null, vegetation: null, confirmedTrees: null, terrain: null, exploration: null, access: null } as Record<GroupId, boolean | null>;
    for (const g of groups) r[g] = preds[g]!(i);
    return r;
  };
  const match = (i: number): boolean => {
    if (!list.length || grid.terrain[i * 4 + 3] === 0) return false; // 海・データなし
    for (const f of list) if (!f(i)) return false;
    return true;
  };
  return { groups, test, match, missing };
}

export interface MatchResult {
  mask: Uint8Array;
  matchCells: number;
  unexploredCells: number; // 条件を満たす範囲のうち、探索実績が「未探索」（対象を選んでいなければ全対象共通）
  matchKm2: number;
  unexploredKm2: number;
}

export function computeMatch(ctx: MatchContext, ch: CompiledHypothesis): MatchResult {
  const N = ctx.m.grid.width * ctx.m.grid.height;
  const mask = new Uint8Array(N);
  let n = 0, u = 0;
  if (ch.groups.length) {
    for (let i = 0; i < N; i++) {
      if (!ch.match(i)) continue;
      mask[i] = 1;
      n++;
      if (!ctx.te || ctx.te.state[i] === 0) u++;
    }
  }
  const a = (ctx.m.grid.pxM * ctx.m.grid.pxM) / 1e6;
  return { mask, matchCells: n, unexploredCells: u, matchKm2: n * a, unexploredKm2: u * a };
}

export const MATCH_COLOR: [number, number, number, number] = [216, 27, 96, 170];
export function renderMatch(mask: Uint8Array, out: Uint8ClampedArray): void {
  for (let i = 0; i < mask.length; i++) if (mask[i]) out.set(MATCH_COLOR, i * 4);
}

// ---- 条件の文（常に表示。データの年を付ける） ----
const DIR_JA: Record<string, string> = { N: '北', NE: '北東', E: '東', SE: '南東', S: '南', SW: '南西', W: '西', NW: '北西' };
export interface SourceYears { forestPlan: string | null; vegetation: string | null }
export function describeConditions(raw: HypothesisConditions, target: { name: string } | null, years: SourceYears, stateLabel: (s: ExplorationState) => string): string[] {
  const c = normalizeConditions(raw);
  const out: string[] = [];
  const fpd = forestPlanOf(c.forestPlan);
  if (fpd) out.push(`森林計画（${years.forestPlan ?? '—'}）${fpd.species} ${fpd.ranks.map((r) => `${r}位`).join('・')}`);
  if (c.vegetation) out.push(`植生図（${years.vegetation ?? '—'}調査）ミズナラ系群落: ${c.vegetation.communities.join('・')}`);
  if (c.confirmedTrees) out.push(`現地確認の${c.confirmedTrees.treeName}から ${c.confirmedTrees.withinM}m 以内`);
  if (c.terrain) {
    const t: string[] = [];
    if (c.terrain.candidate) t.push(`傾斜 ${c.terrain.candidate.slopeMinDeg}° 以上・日射 上位 ${c.terrain.candidate.sunTopPct}%・尾根から ${Math.round(c.terrain.candidate.ridgeMaxM)}m 以内`);
    const d = c.terrain.dem;
    if (d) {
      if (d.directions.length) t.push(d.directions.map((x) => DIR_JA[x]).join('・'));
      if (d.landforms.length) t.push(`斜面の位置 ${d.landforms.length} 種`);
      if (d.wetness.length) t.push(`湿潤度 ${d.wetness.length} 段階`);
      if (d.streamWithinM !== null) t.push(`沢から ${d.streamWithinM}m 以内`);
      if (d.streamBeyondM !== null) t.push(`沢から ${d.streamBeyondM}m 以上`);
    }
    out.push(t.join('・'));
  }
  if (c.exploration) {
    const s = c.exploration.states.map(stateLabel).join('・');
    const b = c.exploration.lastExploredBeforeMonths !== null ? `最終探索が ${c.exploration.lastExploredBeforeMonths} か月以上前` : '';
    out.push(`${[s, b].filter(Boolean).join('・')}${target ? `（${target.name}）` : ''}`);
  }
  if (c.access) {
    const a: string[] = [];
    if (c.access.roadWithinM !== null) a.push(`車道・林道から ${c.access.roadWithinM}m 以内`);
    if (c.access.trailWithinM !== null) a.push(`徒歩道から ${c.access.trailWithinM}m 以内`);
    out.push(a.join(' または '));
  }
  return out;
}

// ---- スナップショット（hypothesis_json）。探索記録に付けたら変わらない（コピーして保存。参照しない） ----
export interface HypothesisSnapshot {
  schema: typeof HYPOTHESIS_SCHEMA;
  id: string;
  name: string;
  savedAt: string;
  target: { speciesId: string; name: string } | null;
  areaId: string;
  data: {
    terrainVersion: string;
    terrainCreatedAt: string;
    sources: { name: string }[]; // manifest の出典
    forest: { present: boolean; sources: Record<string, { name: string; year?: number; years?: [number, number] | null }> | null };
    demDerived: { present: boolean }; // terrain2（方位・沢・湿潤度・斜面の位置）
    evidence: {
      period: string;
      purposeFilter: string;
      tracks: number;
      foundTracks: number;
      notFoundTracks: number;
      foundPoints: number;
      notFoundPoints: number;
      latestExploredOn: string | null;
      confirmedTrees: number;
    };
  };
  params: { coverageWidthM: number; pointRadiusM: number; pxM: number };
  conditions: HypothesisConditions;
  conditionText: string[];
  summary: { matchKm2: number; unexploredKm2: number; matchCells: number; unexploredCells: number };
  app: { build: string };
}

export const MAX_SNAPSHOT_BYTES = 8 * 1024;

export function buildSnapshot(input: {
  id: string; name: string; now: Date; target: { speciesId: string; name: string } | null;
  m: TerrainManifest; forest: ForestData | null; hydroPresent: boolean;
  evidence: HypothesisSnapshot['data']['evidence'];
  coverageWidthM: number; pointRadiusM: number;
  conditions: HypothesisConditions; conditionText: string[]; result: MatchResult; appBuild: string;
}): HypothesisSnapshot {
  const r3 = (v: number) => Math.round(v * 1000) / 1000;
  const snap: HypothesisSnapshot = {
    schema: HYPOTHESIS_SCHEMA,
    id: input.id,
    name: input.name.trim().slice(0, 80),
    savedAt: input.now.toISOString(),
    target: input.target,
    areaId: input.m.areaId,
    data: {
      terrainVersion: input.m.version,
      terrainCreatedAt: input.m.createdAt,
      sources: input.m.sources.map((s) => ({ name: s.name })),
      forest: { present: !!input.forest, sources: input.forest ? input.forest.sources : null },
      demDerived: { present: input.hydroPresent },
      evidence: input.evidence,
    },
    params: { coverageWidthM: input.coverageWidthM, pointRadiusM: input.pointRadiusM, pxM: input.m.grid.pxM },
    conditions: JSON.parse(JSON.stringify(normalizeConditions(input.conditions))) as HypothesisConditions,
    conditionText: input.conditionText,
    summary: { matchKm2: r3(input.result.matchKm2), unexploredKm2: r3(input.result.unexploredKm2), matchCells: input.result.matchCells, unexploredCells: input.result.unexploredCells },
    app: { build: input.appBuild },
  };
  if (new TextEncoder().encode(JSON.stringify(snap)).length > MAX_SNAPSHOT_BYTES) throw new Error('仮説が大きすぎて保存できません（8KB まで）');
  return snap;
}

// 名前の案（条件の文を短く）
export function suggestName(target: { name: string } | null, texts: string[]): string {
  const head = target ? target.name : '地形';
  return `${head}: ${texts.map((t) => t.replace(/（[^）]*）/g, '')).join('×')}`.slice(0, 60);
}
