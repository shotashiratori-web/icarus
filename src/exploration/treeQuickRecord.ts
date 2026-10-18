// 木を撮ってすぐ記録（icarus_tree_quick_record_v1_design.md）。メモの形を 1 か所で決める。
// 例「太さ80cm・株立ち・林縁・位置±8m｜根元に穴」。D1 の形は変えず memo の文字だけ（後で parseTreeMemo で読む）

export const TREE_TAGS = ['株立ち', '切株', '立ち枯れ', '倒木', '空洞', '林縁', 'マイタケ跡'] as const;
export type TreeTag = (typeof TREE_TAGS)[number];
// 樹種の一覧（先頭は前回の樹種に入れ替える）。一覧に無い時は「その他」で入力
export const TREE_SPECIES = ['ミズナラ', 'カツラ', 'ハルニレ', 'ヤチダモ', 'イタヤカエデ', 'ダケカンバ', 'シナノキ', 'ホオノキ'];
export const DEFAULT_TREE_SPECIES = 'ミズナラ';
export const DBH_MIN_CM = 1;
export const DBH_MAX_CM = 500;

// 太さの入力（全角も可）。空・範囲外・数字でない → null
export function parseDbhInput(text: string): number | null {
  const t = text.normalize('NFKC').trim();
  if (!/^\d+(\.\d+)?$/.test(t)) return null;
  const v = Math.round(Number(t));
  return v >= DBH_MIN_CM && v <= DBH_MAX_CM ? v : null;
}

export interface TreeMemoInput { dbhCm: number | null; tags: readonly string[]; note: string; accuracyM: number | null }

// ボタンは TREE_TAGS の順にそろえる（押した順にしない。後で読みやすく）
export function buildTreeMemo(m: TreeMemoInput): string {
  const head: string[] = [];
  if (m.dbhCm !== null) head.push(`太さ${m.dbhCm}cm`);
  for (const t of TREE_TAGS) if (m.tags.includes(t)) head.push(t);
  head.push(m.accuracyM === null ? '位置なし' : `位置±${Math.max(1, Math.round(m.accuracyM))}m`);
  const note = m.note.replace(/[｜|]/g, '／').trim();
  return note ? `${head.join('・')}｜${note}` : head.join('・');
}

export interface ParsedTreeMemo { dbhCm: number | null; tags: TreeTag[]; accuracyM: number | null; note: string }
// buildTreeMemo の形を読む。形が違う（手で書いたメモ）なら null
export function parseTreeMemo(memo: string): ParsedTreeMemo | null {
  const [head, ...rest] = memo.split('｜');
  const parts = head.split('・');
  if (!parts.some((p) => /^位置(±\d+m|なし)$/.test(p))) return null;
  const dbh = parts.map((p) => p.match(/^太さ(\d+)cm$/)).find(Boolean);
  const acc = parts.map((p) => p.match(/^位置±(\d+)m$/)).find(Boolean);
  return {
    dbhCm: dbh ? Number(dbh[1]) : null,
    tags: TREE_TAGS.filter((t) => parts.includes(t)),
    accuracyM: acc ? Number(acc[1]) : null,
    note: rest.join('｜'),
  };
}

const LAST_SPECIES_KEY = 'icarus:tree-quick-species';
export function loadLastTreeSpecies(): string {
  try { return localStorage.getItem(LAST_SPECIES_KEY) || DEFAULT_TREE_SPECIES; } catch { return DEFAULT_TREE_SPECIES; }
}
export function saveLastTreeSpecies(name: string): void {
  try { localStorage.setItem(LAST_SPECIES_KEY, name); } catch { /* 端末に保存できなくても記録は続ける */ }
}
// 樹種のボタンの並び: 前回の樹種を先頭に（一覧に無ければ先頭に足す）
export function speciesChoices(last: string): string[] {
  return [last, ...TREE_SPECIES.filter((s) => s !== last)];
}
