import { describe, expect, it } from 'vitest';
import { ALL_SPECIES, filterBySpecies, speciesKey, speciesOptions } from '../src/terrain/speciesFilter';
import type { FieldLogEntry } from '../src/types/zukan';

// 地形探索の Field Log 種名フィルター: 表記ゆれは検索の時だけそろえる（DB は書き換えない）

const e = (foodName: string, i: number): FieldLogEntry => ({
  id: String(i), foodName, place: '', date: '2026-09-22', memo: '', photoUrl: '', notionUrl: '', elevation: null, kigo: '',
  lat: 43.1, lng: 140.8, recordedAt: '', eventId: '', takenAt: '', largeCategory: 'キノコ',
});

describe('speciesKey', () => {
  it('1. ひらがな／カタカナ・全角半角・空白・末尾の？をそろえる', () => {
    expect(speciesKey('ならたけ')).toEqual({ key: 'ナラタケ', uncertain: false });
    expect(speciesKey('ナラタケ')).toEqual({ key: 'ナラタケ', uncertain: false });
    expect(speciesKey(' ナラタケ？')).toEqual({ key: 'ナラタケ', uncertain: true });
    expect(speciesKey('ﾅﾗﾀｹ?')).toEqual({ key: 'ナラタケ', uncertain: true });
    expect(speciesKey('')).toEqual({ key: '', uncertain: false });
  });
});

describe('speciesOptions / filterBySpecies', () => {
  const list = ['ナラタケ', 'ナラタケ', 'ならたけ', 'ナラタケ？', 'マスタケ', 'ブナハリタケ？', '', 'しめじ系'].map(e);

  it('2. 同じ種にまとめて件数の多い順。表示名はいちばん多い書き方、？付きの件数も出す', () => {
    const o = speciesOptions(list);
    expect(o[0]).toEqual({ key: 'ナラタケ', label: 'ナラタケ', count: 4, uncertain: 1 });
    expect(o.find((x) => x.key === 'ブナハリタケ')).toMatchObject({ label: 'ブナハリタケ', count: 1, uncertain: 1 });
    expect(o.find((x) => x.key === 'シメジ系')?.label).toBe('しめじ系'); // 元の書き方で出す
    expect(o.some((x) => x.key === '')).toBe(false); // 名前なしは選択肢にしない
  });

  it('3. 選んだ種だけ（表記ゆれ・？付きを含む）。すべてなら絞らない', () => {
    expect(filterBySpecies(list, 'ナラタケ').map((x) => x.foodName)).toEqual(['ナラタケ', 'ナラタケ', 'ならたけ', 'ナラタケ？']);
    expect(filterBySpecies(list, ALL_SPECIES)).toHaveLength(list.length);
  });
});

describe('地形探索の Field Log の表示（大分類・小分類）', () => {
  it('山菜は 植物/山菜 だけ。きのこ＋山菜は両方。植物（すべて）は小分類を問わない', async () => {
    const { matchesFieldLogFilter } = await import('../src/terrain/speciesFilter');
    const kinoko = { largeCategory: 'キノコ', subCategory: '不明' };
    const sansai = { largeCategory: '植物', subCategory: '山菜' };
    const yasai = { largeCategory: '植物', subCategory: '野菜' };
    const plantUnknown = { largeCategory: '植物' };
    const fish = { largeCategory: '魚介', subCategory: '魚' };
    const pick = (f: Parameters<typeof matchesFieldLogFilter>[1]) => [kinoko, sansai, yasai, plantUnknown, fish].map((e) => matchesFieldLogFilter(e, f));
    expect(pick('キノコ')).toEqual([true, false, false, false, false]);
    expect(pick('山菜')).toEqual([false, true, false, false, false]);
    expect(pick('キノコ+山菜')).toEqual([true, true, false, false, false]);
    expect(pick('植物')).toEqual([false, true, true, true, false]);
    expect(pick('all')).toEqual([true, true, true, true, true]);
    expect(pick('none')).toEqual([false, false, false, false, false]);
  });
});
