import { latLngToGrid } from './engine';
import { forEachCellNearTrack } from './coverage';
import { speciesKey } from './speciesFilter';
import type { TerrainManifest } from './types';

// 対象ごとの探索実績（S4 §2）。保存しない。表示の時に、探索履歴・観察・Field Log から格子ごとに求める。
// 点数ではない。1 つの格子に証拠が重なった時に「どれを色にするか」の順だけを決める:
//   見つかった（点） > 未確定 > 探して見つからず > 探して見つかった探索の軌跡（地点なし） > 歩いたが未記録 > 未探索
// 未確定（2026-10-20）: 名前の末尾に「？」がある見つかった記録（例 Field Log「シャカしめじ？」）。すべての探す対象に共通。
//   「見つかった」とは別の状態で、見つかったの数・塗りには入れない（色も模様も違う）
// 設計: icarus/docs/architecture/icarus_s4_exploration_hypothesis_final_design.md

export const EXPLORATION_STATES = ['unexplored', 'walked', 'foundTrack', 'notFound', 'uncertain', 'foundPoint'] as const;
export type ExplorationState = (typeof EXPLORATION_STATES)[number];
// 配列に入れる値（大きいほど優先）
export const STATE_CODE: Record<ExplorationState, number> = { unexplored: 0, walked: 1, foundTrack: 2, notFound: 3, uncertain: 4, foundPoint: 5 };

export const STATE_LABEL: Record<ExplorationState, string> = {
  foundPoint: '見つかった（地点）',
  uncertain: '未確定（「？」の記録）',
  notFound: '探して見つからず',
  foundTrack: '見つかった探索の軌跡（地点なし）',
  walked: '歩いたが未記録',
  unexplored: '未探索',
};
// 対象を選んでいない時（今までと同じ「探索済み／未探索」）
export const STATE_LABEL_NO_TARGET: Partial<Record<ExplorationState, string>> = { walked: '探索済み', unexplored: '未探索' };

export const STATE_COLORS: Record<Exclude<ExplorationState, 'unexplored'>, [number, number, number, number]> = {
  foundPoint: [27, 94, 32, 200],
  uncertain: [255, 160, 0, 230], // 琥珀色の斜線（renderTargetExploration）。確定の緑・見つからずの赤と色も模様も分ける
  notFound: [198, 40, 40, 150],
  foundTrack: [102, 187, 106, 140],
  walked: [96, 125, 139, 110],
};

export const DEFAULT_POINT_RADIUS_M = 50;

export interface TargetSpec {
  speciesId: string;
  name: string;
  aliases: string[];
}

// 名前が対象と同じか（種名フィルターと同じ正規化。末尾の「？」は同じ種に紐づけるが、状態は「未確定」にする）
export function targetKeys(t: TargetSpec): Set<string> {
  return new Set([t.name, ...t.aliases].map((n) => speciesKey(n).key).filter(Boolean));
}
// 名前の末尾に「？」などがある＝未確定（種名フィルターの speciesKey と同じ判定）
export const isUncertainName = (name: string) => speciesKey(name).uncertain;
// 点の状態: 見つかった（確定）／未確定（「？」付きの見つかった）／見つからず
export function pointState(p: Pick<PointEvidence, 'name' | 'result'>): 'foundPoint' | 'uncertain' | 'notFound' {
  if (p.result !== 'found') return 'notFound';
  return isUncertainName(p.name) ? 'uncertain' : 'foundPoint';
}
export function nameMatches(keys: Set<string>, name: string): boolean {
  const k = speciesKey(name).key;
  return !!k && keys.has(k);
}

export interface TrackEvidence {
  segments: [number, number][][];
  exploredOn: string | null; // YYYY-MM-DD
  targets: { target: string; result: 'found' | 'not_found' | 'unknown' }[];
}
export interface PointEvidence {
  lat: number;
  lng: number;
  name: string; // 対象名（Field Log の食材名・観察の対象名）
  result: 'found' | 'not_found';
  date: string | null; // YYYY-MM-DD
}

// 1 回の探索がこの対象についてどうだったか。同じ探索で found があれば found（どこかで見つかった）
export function trackResultFor(keys: Set<string> | null, t: TrackEvidence): ExplorationState {
  if (!keys) return 'walked';
  const mine = t.targets.filter((x) => nameMatches(keys, x.target));
  if (mine.some((x) => x.result === 'found' && !isUncertainName(x.target))) return 'foundTrack';
  if (mine.some((x) => x.result === 'found')) return 'uncertain'; // 見つかったが「？」付きだけ
  if (mine.some((x) => x.result === 'not_found')) return 'notFound';
  return 'walked';
}

const dayNum = (d: string | null) => {
  if (!d) return 0;
  const t = Date.parse(`${d.slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(t) ? 0 : Math.floor(t / 86400000);
};
export const dayToDate = (n: number) => new Date(n * 86400000).toISOString().slice(0, 10);

export interface TargetExploration {
  width: number; // 格子の幅（斜線を描くため）
  state: Uint8Array; // STATE_CODE
  lastDay: Int32Array; // 最終探索日（1970-01-01 からの日数、0 = なし）。対象に関係なく
  counts: { tracks: number; foundTracks: number; uncertainTracks: number; notFoundTracks: number; foundPoints: number; uncertainPoints: number; notFoundPoints: number; latest: string | null };
}

export function buildTargetExploration(
  m: TerrainManifest,
  target: TargetSpec | null,
  tracks: TrackEvidence[],
  points: PointEvidence[],
  widthM: number,
  pointRadiusM: number = DEFAULT_POINT_RADIUS_M,
): TargetExploration {
  const N = m.grid.width * m.grid.height;
  const state = new Uint8Array(N);
  const lastDay = new Int32Array(N);
  const keys = target ? targetKeys(target) : null;
  const counts = { tracks: 0, foundTracks: 0, uncertainTracks: 0, notFoundTracks: 0, foundPoints: 0, uncertainPoints: 0, notFoundPoints: 0, latest: null as string | null };
  let latest = 0;
  for (const t of tracks) {
    const code = STATE_CODE[trackResultFor(keys, t)];
    const day = dayNum(t.exploredOn);
    latest = Math.max(latest, day);
    counts.tracks++;
    if (code === STATE_CODE.foundTrack) counts.foundTracks++;
    if (code === STATE_CODE.uncertain) counts.uncertainTracks++;
    if (code === STATE_CODE.notFound) counts.notFoundTracks++;
    forEachCellNearTrack(m, t.segments, widthM, (i) => {
      if (state[i] < code) state[i] = code;
      if (lastDay[i] < day) lastDay[i] = day;
    });
  }
  // 点の証拠は対象を選んだ時だけ（対象が無ければ「何が見つかったか」が決まらない）
  if (keys) {
    const W = m.grid.width;
    const H = m.grid.height;
    const R = Math.max(0.5, pointRadiusM / m.grid.pxM);
    const Ri = Math.ceil(R);
    for (const p of points) {
      if (!nameMatches(keys, p.name)) continue;
      const st = pointState(p);
      const code = STATE_CODE[st];
      if (st === 'foundPoint') counts.foundPoints++; else if (st === 'uncertain') counts.uncertainPoints++; else counts.notFoundPoints++;
      const day = dayNum(p.date);
      latest = Math.max(latest, day);
      const g = latLngToGrid(m, p.lat, p.lng);
      const cx = Math.floor(g.x);
      const cy = Math.floor(g.y);
      for (let dy = -Ri; dy <= Ri; dy++) {
        const Y = cy + dy;
        if (Y < 0 || Y >= H) continue;
        for (let dx = -Ri; dx <= Ri; dx++) {
          const X = cx + dx;
          if (X < 0 || X >= W || dx * dx + dy * dy > R * R) continue;
          const i = Y * W + X;
          if (state[i] < code) state[i] = code;
          if (lastDay[i] < day) lastDay[i] = day;
        }
      }
    }
  }
  counts.latest = latest ? dayToDate(latest) : null;
  return { width: m.grid.width, state, lastDay, counts };
}

export function stateAt(te: TargetExploration, i: number): ExplorationState {
  return EXPLORATION_STATES[te.state[i]];
}

// 面積（km²）を状態ごとに
export function stateAreasKm2(m: TerrainManifest, te: TargetExploration, land?: (i: number) => boolean): Record<ExplorationState, number> {
  const c = EXPLORATION_STATES.map(() => 0);
  for (let i = 0; i < te.state.length; i++) if (!land || land(i)) c[te.state[i]]++;
  const a = (m.grid.pxM * m.grid.pxM) / 1e6;
  return Object.fromEntries(EXPLORATION_STATES.map((s, k) => [s, c[k] * a])) as Record<ExplorationState, number>;
}

export function renderTargetExploration(te: TargetExploration, out: Uint8ClampedArray): void {
  const W = te.width || 1;
  for (let i = 0; i < te.state.length; i++) {
    const s = te.state[i];
    if (!s) continue;
    // 未確定は斜線（2 格子おき）。塗りつぶしの「見つかった」と模様でも分かる
    if (s === STATE_CODE.uncertain && ((i % W) + Math.floor(i / W)) % 4 >= 2) continue;
    out.set(STATE_COLORS[EXPLORATION_STATES[s] as Exclude<ExplorationState, 'unexplored'>], i * 4);
  }
}

// 地点の説明（優先に関係なく、その格子に当たる証拠を全部並べる）
export function describeTargetAt(
  target: TargetSpec | null, tracks: TrackEvidence[], points: PointEvidence[], widthM: number, pointRadiusM: number,
  lat: number, lng: number, distToTrack: (lat: number, lng: number, seg: [number, number][][]) => number,
): string[] {
  const keys = target ? targetKeys(target) : null;
  const by: Record<string, { n: number; last: string | null }> = {};
  const add = (k: string, d: string | null) => {
    const o = by[k] ?? { n: 0, last: null };
    o.n++;
    if (d && (!o.last || d > o.last)) o.last = d;
    by[k] = o;
  };
  for (const t of tracks) if (distToTrack(lat, lng, t.segments) <= widthM) add(keys ? STATE_LABEL[trackResultFor(keys, t)] : '探索済み', t.exploredOn);
  if (keys) {
    const ky = 111320, kx = 111320 * Math.cos((lat * Math.PI) / 180);
    for (const p of points) {
      if (!nameMatches(keys, p.name)) continue;
      if (Math.hypot((p.lat - lat) * ky, (p.lng - lng) * kx) > pointRadiusM) continue;
      const st = pointState(p);
      add(st === 'foundPoint' ? STATE_LABEL.foundPoint : st === 'uncertain' ? `${target!.name}（未確定・記録「${p.name}」）` : `${STATE_LABEL.notFound}（観察）`, p.date);
    }
  }
  const head = target ? `探索実績（${target.name}）` : '探索実績';
  const parts = Object.entries(by).map(([k, v]) => `${k} ${v.n}回${v.last ? `（最終 ${v.last}）` : ''}`);
  return [`${head}: ${parts.length ? parts.join('・') : STATE_LABEL.unexplored}`];
}

// 環境スポットのマーカーの強調（S4a）: 対象を選んだ時だけ、その対象の観察（日時ごと）から決める。
// 最新で上書きしない。1 回でも「あり」なら見つかった、次に「なし」。対象の観察が無ければ null（従来表示）。
// ほかの種の結果は混ぜない。履歴はタップした詳細でそのまま全部見られる
export type SpotTargetStatus = 'found' | 'uncertain' | 'notFound';
export function spotTargetStatus(keys: Set<string> | null, obs: { name: string; result: string }[]): SpotTargetStatus | null {
  if (!keys) return null;
  const mine = obs.filter((o) => nameMatches(keys, o.name));
  if (mine.some((o) => o.result === 'found' && !isUncertainName(o.name))) return 'found';
  if (mine.some((o) => o.result === 'found')) return 'uncertain';
  if (mine.some((o) => o.result === 'not_found')) return 'notFound';
  return null;
}
