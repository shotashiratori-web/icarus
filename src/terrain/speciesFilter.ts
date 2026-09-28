import type { FieldLogEntry } from '../types/zukan';

// 地形探索の Field Log を種名で絞る（Species Exploration の A 段階）。推測は含まず、過去に記録した地点を出すだけ。
// 表記ゆれは DB を書き換えず、ここで検索の時だけそろえる: 全角半角（NFKC）・ひらがな→カタカナ・空白。
// 末尾の「？」は同じ種の「未確定」として数える（ナラタケ？ → ナラタケ・未確定）

export interface SpeciesKey {
  key: string; // '' = 名前なし
  uncertain: boolean;
}

const hiraToKata = (s: string) => s.replace(/[ぁ-ゖ]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60));

export function speciesKey(name: string): SpeciesKey {
  let s = (name ?? '').normalize('NFKC').replace(/\s+/g, '');
  const uncertain = /\?+$/.test(s);
  s = s.replace(/\?+$/, '');
  return { key: hiraToKata(s), uncertain };
}

export interface SpeciesOption {
  key: string;
  label: string; // いちばん多い書き方（「？」を除く）
  count: number;
  uncertain: number; // うち「？」付き
}

export function speciesOptions(entries: FieldLogEntry[]): SpeciesOption[] {
  const map = new Map<string, { count: number; uncertain: number; spellings: Map<string, number> }>();
  for (const e of entries) {
    const { key, uncertain } = speciesKey(e.foodName);
    if (!key) continue;
    const o = map.get(key) ?? { count: 0, uncertain: 0, spellings: new Map<string, number>() };
    o.count++;
    if (uncertain) o.uncertain++;
    const spelling = (e.foodName ?? '').normalize('NFKC').replace(/\s+/g, '').replace(/\?+$/, '');
    o.spellings.set(spelling, (o.spellings.get(spelling) ?? 0) + 1);
    map.set(key, o);
  }
  return [...map.entries()]
    .map(([key, o]) => ({
      key,
      label: [...o.spellings.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ja'))[0][0],
      count: o.count,
      uncertain: o.uncertain,
    }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'ja'));
}

export const ALL_SPECIES = 'all';

export function filterBySpecies(entries: FieldLogEntry[], key: string): FieldLogEntry[] {
  if (key === ALL_SPECIES) return entries;
  return entries.filter((e) => speciesKey(e.foodName).key === key);
}
