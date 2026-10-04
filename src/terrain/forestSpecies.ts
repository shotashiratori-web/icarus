import type { ForestData, ForestStand } from './forest';

// 森林計画の任意樹種（設計: icarus/docs/architecture/icarus_forest_any_species_layer_final_design.md）。
// 元データ（forest.json の樹種名）は変えない。表示の時だけ表記をそろえ、グループは UI の便利機能として持つ
// （「カンバ類」という樹種データは作らない。個別種でもグループでも選べる）

// 表記の統一（国有林と民有林で書き方が違うもの）
const DISPLAY_NAME: Record<string, string> = {
  シラカバ: 'シラカンバ',
  センノキ: 'ハリギリ',
  'ハルニレ（アカダモ）': 'ハルニレ',
  ヒノキアスナロ: 'ヒバ',
  '他Ｌ': 'その他広葉樹', '他L': 'その他広葉樹',
  '他Ｎ': 'その他針葉樹', '他N': 'その他針葉樹',
};

// 民有林の森林調査簿コード表に定義の無いコード（73・75・80・81・87・88 など。すべて人工林）。名前は推測しない
const UNKNOWN_CODE = /^コード(\d+)$/;

// 樹種が決まらないもの（選択肢に出さない）
const UNKNOWN_NAMES = new Set([
  '天然林広葉樹', 'その他広葉樹', 'その他針葉樹', '天然林針葉樹', '針広混交林', 'その他人工林広葉樹', 'その他人工林針葉樹',
]);

export function displaySpeciesName(raw: string): string {
  const m = (raw ?? '').match(UNKNOWN_CODE);
  if (m) return `人工林の樹種（コード${m[1]}・名前不明）`;
  return DISPLAY_NAME[raw] ?? raw;
}

export function isUnknownSpecies(raw: string): boolean {
  return UNKNOWN_CODE.test(raw ?? '') || UNKNOWN_NAMES.has(displaySpeciesName(raw));
}

// グループ（UI の便利機能）。中身は表示名
export const SPECIES_GROUPS: Record<string, string[]> = {
  カンバ類: ['カンバ', 'シラカンバ', 'ダケカンバ', 'ウダイカンバ', 'その他カンバ'],
  カラマツ類: ['カラマツ', 'グイマツ', 'グイマツ雑種F1', 'クリーンラーチ', 'チョウセンカラマツ'],
  ハンノキ類: ['ハンノキ', 'ハンノキ・ヤチハンノキ', 'ヤマハンノキ', 'ケヤマハンノキ', 'コバノヤマハンノキ', 'グルチノーザハンノキ'],
  トウヒ類: ['エゾマツ', 'アカエゾマツ', 'ドイツトウヒ'],
};
export const isGroup = (name: string) => Object.prototype.hasOwnProperty.call(SPECIES_GROUPS, name);
export const membersOf = (name: string): string[] => (isGroup(name) ? SPECIES_GROUPS[name] : [name]);

// 林分の中での順位（1〜3）。グループは中身のうち一番上の順位。無ければ 0
export function standRankOf(stand: Pick<ForestStand, 'species'>, selection: string): 0 | 1 | 2 | 3 {
  const names = new Set(membersOf(selection));
  for (let k = 0; k < Math.min(3, stand.species.length); k++) {
    if (names.has(displaySpeciesName(stand.species[k][0]))) return (k + 1) as 1 | 2 | 3;
  }
  return 0;
}

// 林分ごとの順位の表（林分番号 - 1 で引く）。選んだ時に 1 回だけ作る
export function standRanks(f: Pick<ForestData, 'stands'>, selection: string | null): Uint8Array {
  const out = new Uint8Array(f.stands.length);
  if (!selection) return out;
  f.stands.forEach((s, i) => { out[i] = standRankOf(s, selection); });
  return out;
}

export interface SpeciesOption {
  name: string; // 表示名（個別種）またはグループ名
  group: boolean;
  stands: number; // 1〜3 位に入る林分の数
}

// 選択肢: 個別種とグループ。ミズナラを先頭に固定し、あとは林分の数が多い順（将来「最近使った樹種」を上に出せる形）
export function forestSpeciesOptions(f: Pick<ForestData, 'stands'>, pinned: string[] = ['ミズナラ']): SpeciesOption[] {
  const count = new Map<string, number>();
  for (const s of f.stands) {
    const seen = new Set<string>();
    for (const [raw] of s.species.slice(0, 3)) {
      if (isUnknownSpecies(raw)) continue;
      const n = displaySpeciesName(raw);
      if (seen.has(n)) continue;
      seen.add(n);
      count.set(n, (count.get(n) ?? 0) + 1);
    }
  }
  const opts: SpeciesOption[] = [...count.entries()].map(([name, stands]) => ({ name, group: false, stands }));
  for (const [g] of Object.entries(SPECIES_GROUPS)) {
    const n = f.stands.filter((s) => standRankOf(s, g) > 0).length;
    if (n > 0) opts.push({ name: g, group: true, stands: n });
  }
  opts.sort((a, b) => {
    const pa = pinned.indexOf(a.name), pb = pinned.indexOf(b.name);
    if (pa >= 0 || pb >= 0) return (pa < 0 ? 999 : pa) - (pb < 0 ? 999 : pb);
    return b.stands - a.stands;
  });
  return opts;
}

// 個別種を選んだ時、同じグループの「属まで」の記録（国有林の「カンバ」など）が含まれないことの案内
export function genusOnlyNotice(f: Pick<ForestData, 'stands'>, selection: string | null): string | null {
  if (!selection || isGroup(selection)) return null;
  for (const [g, members] of Object.entries(SPECIES_GROUPS)) {
    if (!members.includes(selection)) continue;
    const genus = members[0] === 'カンバ' ? 'カンバ' : null;
    if (!genus || selection === genus) return null;
    const n = f.stands.filter((s) => s.species.slice(0, 3).some(([raw]) => displaySpeciesName(raw) === genus)).length;
    return n > 0 ? `国有林の「${genus}」（${n.toLocaleString()} 林分）は種が分からないため含みません。「${g}」で見られます` : null;
  }
  return null;
}
