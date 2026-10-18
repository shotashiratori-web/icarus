import { describe, expect, it } from 'vitest';
import { buildTreeMemo, parseDbhInput, parseTreeMemo, speciesChoices } from '../src/exploration/treeQuickRecord';

// 木を撮ってすぐ記録（icarus_tree_quick_record_v1_design.md §3）

describe('太さの入力', () => {
  it('数字（全角も）を cm に。空・数字でない・範囲外は null', () => {
    expect(parseDbhInput('80')).toBe(80);
    expect(parseDbhInput('８０')).toBe(80);
    expect(parseDbhInput(' 79.6 ')).toBe(80);
    expect(parseDbhInput('')).toBeNull();
    expect(parseDbhInput('80cm')).toBeNull();
    expect(parseDbhInput('0')).toBeNull();
    expect(parseDbhInput('900')).toBeNull();
  });
});

describe('メモの形', () => {
  it('太さ・ボタン（決まった順）・位置｜自由メモ', () => {
    expect(buildTreeMemo({ dbhCm: 80, tags: ['林縁', '株立ち'], note: '根元に穴', accuracyM: 7.6 })).toBe('太さ80cm・株立ち・林縁・位置±8m｜根元に穴');
  });
  it('太さなし・自由メモなし・位置なし', () => {
    expect(buildTreeMemo({ dbhCm: null, tags: [], note: '  ', accuracyM: null })).toBe('位置なし');
    expect(buildTreeMemo({ dbhCm: 110, tags: ['立ち枯れ', '倒木'], note: '', accuracyM: 0.2 })).toBe('太さ110cm・立ち枯れ・倒木・位置±1m');
  });
  it('自由メモの区切り文字は置き換える（読み直しで崩れない）', () => {
    expect(buildTreeMemo({ dbhCm: null, tags: [], note: 'a｜b|c', accuracyM: 5 })).toBe('位置±5m｜a／b／c');
  });
  it('読み直すと同じ中身', () => {
    const m = buildTreeMemo({ dbhCm: 65, tags: ['マイタケ跡', '空洞', '切株'], note: '北側', accuracyM: 12 });
    expect(parseTreeMemo(m)).toEqual({ dbhCm: 65, tags: ['切株', '空洞', 'マイタケ跡'], accuracyM: 12, note: '北側' });
  });
  it('手で書いたメモは読まない', () => {
    expect(parseTreeMemo('80センチ')).toBeNull();
    expect(parseTreeMemo('')).toBeNull();
  });
});

describe('樹種のボタンの並び', () => {
  it('前回の樹種を先頭に、重ねない', () => {
    expect(speciesChoices('カツラ').slice(0, 3)).toEqual(['カツラ', 'ミズナラ', 'ハルニレ']);
    expect(speciesChoices('ブナ')[0]).toBe('ブナ');
    expect(new Set(speciesChoices('ミズナラ')).size).toBe(speciesChoices('ミズナラ').length);
  });
});
