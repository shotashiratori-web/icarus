import type { ForestLayers } from './forest';

// 地図の上の状態チップ（設計: icarus/docs/architecture/icarus_exploration_map_information_architecture_v1.md の Stage A）。
// 「いま地図に何が出ているか」を地図の上に短く出す。条件の計算は変えない（表示の要約だけ）。
// 下地（等高線・道・探索履歴・環境スポット）はチップにしない。消し忘れると地図が読めなくなる重ね表示だけ出す

export type StatusChipId = 'forest' | 'candidates' | 'terrain' | 'match' | 'target' | 'fieldLog' | 'analysis';
export type StatusChipTab = 'search' | 'view';

export interface StatusChip {
  id: StatusChipId;
  label: string;
  tab: StatusChipTab; // タップで開くパネルのタブ
  color?: string; // 地図の色見本（森林の 1 位など）
}

export interface StatusChipInput {
  forest: ForestLayers;
  forestAny: boolean;
  candidates: { A: boolean; B: boolean; C: boolean };
  terrainSummary: string | null; // 地形の条件（無ければ null）
  matchKm2: number | null; // 条件に合う範囲（表示していなければ null）
  targetName: string | null; // 探索の対象（地図に出していなければ null）
  fieldLogLabel: string | null; // Field Log の表示（表示しないなら null）
  ridge: boolean;
  sun: boolean;
}

// 1〜3 位の表記: [1,2,3] → 1–3位、[1,3] → 1・3位、[2] → 2位
export function rankText(ranks: number[]): string {
  const r = [...ranks].sort((a, b) => a - b);
  if (r.length === 0) return '';
  const consecutive = r.length >= 2 && r.every((x, i) => i === 0 || x === r[i - 1] + 1);
  return consecutive ? `${r[0]}–${r[r.length - 1]}位` : `${r.join('・')}位`;
}

export function forestChipLabel(l: ForestLayers): string {
  const parts: string[] = [];
  const ranks = [l.mz1 && 1, l.mz2 && 2, l.mz3 && 3].filter((x): x is number => !!x);
  const name = l.species ?? 'ミズナラ';
  if (ranks.length) parts.push(`${name} ${rankText(ranks)}`);
  if (l.kokuyuNoMizunara) parts.push(`国有林・${name}なし`);
  if (l.vegMizunara.length || l.vegOther) parts.push('植生図');
  if (l.larch) parts.push('カラマツ人工林');
  if (l.todo) parts.push('トドマツ人工林');
  if (l.broadleafUnknown) parts.push('広葉樹（樹種不明）');
  return parts.length ? parts.join('・') : '森林';
}

const km2Text = (v: number) => (v < 1 ? v.toFixed(2) : v.toFixed(1));

export function buildStatusChips(s: StatusChipInput, forestColor?: string): StatusChip[] {
  const out: StatusChip[] = [];
  if (s.forestAny) out.push({ id: 'forest', label: forestChipLabel(s.forest), tab: 'search', color: (s.forest.mz1 || s.forest.mz2 || s.forest.mz3) ? forestColor : undefined });
  const abc = (['A', 'B', 'C'] as const).filter((k) => s.candidates[k]).join('');
  if (abc) out.push({ id: 'candidates', label: `候補 ${abc}`, tab: 'search' });
  if (s.terrainSummary) out.push({ id: 'terrain', label: `地形 ${s.terrainSummary}`, tab: 'search' });
  if (s.matchKm2 !== null) out.push({ id: 'match', label: `条件に合う範囲 ${km2Text(s.matchKm2)}km²`, tab: 'search' });
  if (s.targetName) out.push({ id: 'target', label: `探索 ${s.targetName}`, tab: 'search' });
  if (s.fieldLogLabel) out.push({ id: 'fieldLog', label: `Field Log ${s.fieldLogLabel}`, tab: 'view' });
  const analysis = [s.ridge && '尾根線', s.sun && '日射'].filter(Boolean).join('・');
  if (analysis) out.push({ id: 'analysis', label: analysis, tab: 'view' });
  return out;
}
