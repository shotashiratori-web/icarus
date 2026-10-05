import { describe, expect, it } from 'vitest';
import { NO_FOREST_LAYERS } from '../src/terrain/forest';
import { buildStatusChips, forestChipLabel, rankText, type StatusChipInput } from '../src/terrain/statusChips';

const base: StatusChipInput = {
  forest: NO_FOREST_LAYERS,
  forestAny: false,
  candidates: { A: false, B: false, C: false },
  terrainSummary: null,
  matchKm2: null,
  targetName: null,
  fieldLogLabel: null,
  ridge: false,
  sun: false,
};

describe('状態チップ', () => {
  it('何も重ねていなければチップなし', () => {
    expect(buildStatusChips(base)).toEqual([]);
  });

  it('順位の表記', () => {
    expect(rankText([1, 2, 3])).toBe('1–3位');
    expect(rankText([2, 1])).toBe('1–2位');
    expect(rankText([1, 3])).toBe('1・3位');
    expect(rankText([2])).toBe('2位');
  });

  it('森林: 選んだ樹種と順位、色見本は順位を出している時だけ', () => {
    const forest = { ...NO_FOREST_LAYERS, species: 'トドマツ', mz1: true, mz2: true, mz3: true };
    const [c] = buildStatusChips({ ...base, forest, forestAny: true }, 'rgb(1,2,3)');
    expect(c).toMatchObject({ id: 'forest', label: 'トドマツ 1–3位', tab: 'search', color: 'rgb(1,2,3)' });
    const veg = buildStatusChips({ ...base, forest: { ...NO_FOREST_LAYERS, vegOther: true }, forestAny: true }, 'rgb(1,2,3)');
    expect(veg[0]).toMatchObject({ label: '植生図', color: undefined });
  });

  it('森林: 樹種を選んでいない時はミズナラ', () => {
    expect(forestChipLabel({ ...NO_FOREST_LAYERS, mz1: true, larch: true })).toBe('ミズナラ 1位・カラマツ人工林');
  });

  it('候補・地形・条件に合う範囲・探索・Field Log・尾根線/日射を順に出す', () => {
    const chips = buildStatusChips({
      ...base,
      candidates: { A: true, B: false, C: true },
      terrainSummary: '沢沿い',
      matchKm2: 1.42,
      targetName: 'マイタケ',
      fieldLogLabel: 'きのこ',
      ridge: true,
      sun: true,
    });
    expect(chips.map((c) => c.label)).toEqual(['候補 AC', '地形 沢沿い', '条件に合う範囲 1.4km²', '探索 マイタケ', 'Field Log きのこ', '尾根線・日射']);
    expect(chips.map((c) => c.tab)).toEqual(['search', 'search', 'search', 'search', 'view', 'view']);
  });

  it('1km² 未満は小数 2 桁', () => {
    expect(buildStatusChips({ ...base, matchKm2: 0.123 })[0].label).toBe('条件に合う範囲 0.12km²');
  });
});

// 2026-10-05: 状態チップに既存の .chips/.chip と同じ名前を付け、地形の条件・仮説パネルのチップまで地図の上に浮いた（回帰）
describe('状態チップの CSS', () => {
  it('既存のチップ（.chips/.chip）と別の名前で、既存の定義は 1 つだけ', async () => {
    const { readFileSync } = await import('node:fs');
    const css = readFileSync('src/components/terrain/ExplorationMap.module.css', 'utf8');
    expect(css.match(/^\.chips \{/gm)).toHaveLength(1);
    expect(css.match(/^\.chip \{/gm)).toHaveLength(1);
    expect(css).toMatch(/^\.statusChips \{/m);
  });
});
