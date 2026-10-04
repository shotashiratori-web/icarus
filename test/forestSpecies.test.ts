import { describe, expect, it } from 'vitest';
import {
  displaySpeciesName, forestSpeciesOptions, genusOnlyNotice, isUnknownSpecies, membersOf, standRankOf, standRanks,
} from '../src/terrain/forestSpecies';
import type { ForestStand } from '../src/terrain/forest';

// 森林計画の任意樹種（設計 icarus_forest_any_species_layer_final_design.md）: 表記・グループ・樹種不明・順位

const st = (owner: 'k' | 'm', names: string[]): ForestStand => ({ owner, year: owner === 'k' ? 2018 : 2023, name: '', species: names.map((n) => [n, null]), age: null, type: null, mizunaraRank: 0, cls: 0 });
const STANDS = [
  st('k', ['ミズナラ', 'カンバ', '他Ｌ']),
  st('k', ['カンバ', 'シラカバ']),
  st('m', ['トドマツ', 'シラカンバ']),
  st('m', ['トドマツ']),
  st('m', ['カラマツ', 'グイマツ雑種F1']),
  st('m', ['コード88']),
  st('m', ['天然林広葉樹']),
  st('k', ['アカエゾマツ', 'エゾマツ', 'センノキ']),
];

describe('表記と樹種不明', () => {
  it('シラカバ→シラカンバ、センノキ→ハリギリ、他Ｌ→その他広葉樹。コード不明は名前を推測しない', () => {
    expect(displaySpeciesName('シラカバ')).toBe('シラカンバ');
    expect(displaySpeciesName('センノキ')).toBe('ハリギリ');
    expect(displaySpeciesName('他Ｌ')).toBe('その他広葉樹');
    expect(displaySpeciesName('コード88')).toBe('人工林の樹種（コード88・名前不明）');
    expect(isUnknownSpecies('コード73')).toBe(true);
    expect(isUnknownSpecies('天然林広葉樹')).toBe(true);
    expect(isUnknownSpecies('他Ｌ')).toBe(true);
    expect(isUnknownSpecies('ミズナラ')).toBe(false);
  });
});

describe('順位', () => {
  it('個別種は並び順、グループは中身のうち一番上の順位。無ければ 0', () => {
    expect(standRankOf(STANDS[0], 'ミズナラ')).toBe(1);
    expect(standRankOf(STANDS[0], 'カンバ類')).toBe(2);
    expect(standRankOf(STANDS[1], 'シラカンバ')).toBe(2); // 国有林のシラカバ
    expect(standRankOf(STANDS[1], 'カンバ類')).toBe(1); // 国有林のカンバ（属まで）
    expect(standRankOf(STANDS[4], 'カラマツ類')).toBe(1);
    expect(standRankOf(STANDS[4], 'グイマツ雑種F1')).toBe(2);
    expect(standRankOf(STANDS[7], 'トウヒ類')).toBe(1);
    expect(standRankOf(STANDS[7], 'ハリギリ')).toBe(3);
    expect(standRankOf(STANDS[3], 'ミズナラ')).toBe(0);
    expect(Array.from(standRanks({ stands: STANDS }, 'トドマツ'))).toEqual([0, 0, 1, 1, 0, 0, 0, 0]);
    expect(Array.from(standRanks({ stands: STANDS }, null))).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
  });
  it('グループの中身は元データの樹種名を変えない（表示名で照合するだけ）', () => {
    expect(membersOf('トウヒ類')).toEqual(['エゾマツ', 'アカエゾマツ', 'ドイツトウヒ']);
    expect(membersOf('ミズナラ')).toEqual(['ミズナラ']);
    expect(STANDS[1].species[1][0]).toBe('シラカバ');
  });
});

describe('選択肢', () => {
  it('ミズナラを先頭に、あとは林分の数が多い順。樹種不明は出さない。グループは（まとめ）', () => {
    const opts = forestSpeciesOptions({ stands: STANDS });
    expect(opts[0].name).toBe('ミズナラ');
    const names = opts.map((o) => o.name);
    expect(names).not.toContain('天然林広葉樹');
    expect(names).not.toContain('その他広葉樹');
    expect(names.some((n) => n.includes('コード'))).toBe(false);
    expect(opts.find((o) => o.name === 'シラカンバ')?.stands).toBe(2); // シラカバ（国）＋シラカンバ（民）
    expect(opts.find((o) => o.name === 'カンバ類')).toMatchObject({ group: true, stands: 3 });
    expect(opts.find((o) => o.name === 'トドマツ')?.stands).toBe(2);
    expect(names).not.toContain('マツ類');
  });
  it('個別のカンバを選んだ時は、国有林の「カンバ」が含まれないことを知らせる', () => {
    expect(genusOnlyNotice({ stands: STANDS }, 'シラカンバ')).toMatch(/国有林の「カンバ」（2 林分）.*「カンバ類」で見られます/);
    expect(genusOnlyNotice({ stands: STANDS }, 'カンバ類')).toBeNull();
    expect(genusOnlyNotice({ stands: STANDS }, 'トドマツ')).toBeNull();
  });
});
