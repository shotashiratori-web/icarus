import { describe, expect, it } from 'vitest';
import { renderHook } from '@testing-library/react';
import {
  diffByKeys, rebaseByKeys, summarizeBulkOutcomes, formatEditTime, formatEditValue, type EditEquals,
} from '../src/utils/editCore';
import { usePendingRequestId } from '../src/utils/usePendingRequestId';
import { diffValues, rebaseAfterConflict, FIELD_EDIT_ORDER } from '../src/utils/fieldEntryEdit';
import type { FieldEditValues } from '../src/types/fieldEntryEdit';

// 共通の編集ロジック（共通化 Audit、2026-09-27）。Field の Production Gate 済みロジックと同じ結果になることも確認する

type Work = { content: string; caption: string };
const KEYS = ['content', 'caption'] as const;

describe('diffByKeys', () => {
  it('変えた項目だけを返す', () => {
    expect(diffByKeys(KEYS, { content: 'a', caption: 'b' }, { content: 'a2', caption: 'b' })).toEqual({ content: 'a2' });
    expect(diffByKeys(KEYS, { content: 'a', caption: 'b' }, { content: 'a', caption: 'b' })).toEqual({});
  });
  it('配列は並びも含めて比較、equals で比較方法を変えられる', () => {
    const k = ['parts'] as const;
    expect(diffByKeys(k, { parts: ['花'] }, { parts: ['花'] })).toEqual({});
    expect(diffByKeys(k, { parts: ['花', '葉'] }, { parts: ['葉', '花'] })).toEqual({ parts: ['葉', '花'] });
    const trimEq: EditEquals<Work> = (_k, a, b) => String(a).trim() === String(b).trim();
    expect(diffByKeys(KEYS, { content: 'a', caption: '' }, { content: ' a ', caption: '' }, trimEq)).toEqual({});
  });
});

describe('rebaseByKeys（409 の後）', () => {
  it('自分が変えていない項目は最新値、自分が変えた項目は自分の値、両方が変えた項目は overlap', () => {
    const r = rebaseByKeys<Work>(KEYS, { content: '元', caption: '元' }, { content: '自分', caption: '元' }, { content: '他人', caption: '他人の注記' });
    expect(r.values).toEqual({ content: '自分', caption: '他人の注記' });
    expect(r.mine).toEqual(['content']);
    expect(r.overlap).toEqual(['content']);
  });
  it('相手が同じ値に変えていた項目は overlap にしない', () => {
    const r = rebaseByKeys<Work>(KEYS, { content: '元', caption: '' }, { content: 'x', caption: '' }, { content: 'x', caption: '' });
    expect(r.overlap).toEqual([]);
  });
});

describe('Field の Gate 済みロジックと同じ結果になる', () => {
  const base: FieldEditValues = {
    food: 'ナラタケ', date: '2026-09-19', place: '余市', memo: '', large_category: 'キノコ', sub_category: '不明',
    phase: '幼菌', harvested: 'あり', identification_status: '未確認', observed_parts: ['全体'], subject_type: '食材',
  };
  // Field は食材名・日付を trim して比べる
  const fieldEq: EditEquals<FieldEditValues> = (k, a, b) =>
    k === 'food' || k === 'date' ? String(a).trim() === String(b).trim()
      : Array.isArray(a) && Array.isArray(b) ? a.join(',') === b.join(',') : a === b;

  it('diff', () => {
    const form = { ...base, food: ' ナラタケ ', memo: '傘', observed_parts: ['全体', '花'], harvested: 'なし' };
    expect(diffByKeys(FIELD_EDIT_ORDER, base, form, fieldEq)).toEqual(diffValues(base, form));
  });
  it('rebase', () => {
    const form = { ...base, memo: '自分', place: '自分の場所' };
    const latest = { ...base, memo: '他人', identification_status: '推定' };
    const a = rebaseByKeys(FIELD_EDIT_ORDER, base, form, latest, fieldEq);
    const b = rebaseAfterConflict(base, form, latest);
    expect(a.values).toEqual(b.values);
    expect(a.mine).toEqual(b.mine);
    expect(a.overlap).toEqual(b.overlap);
  });
});

describe('summarizeBulkOutcomes / formatEdit*', () => {
  it('成功（applied・alreadyApplied・noChange）／競合／失敗に分ける', () => {
    const s = summarizeBulkOutcomes([
      { id: 'a', outcome: 'applied' }, { id: 'b', outcome: 'alreadyApplied' }, { id: 'c', outcome: 'noChange' },
      { id: 'd', outcome: 'conflict' }, { id: 'e', outcome: 'failed', message: 'x' },
    ]);
    expect(s.succeeded.map((i) => i.id)).toEqual(['a', 'b', 'c']);
    expect(s.noChange.map((i) => i.id)).toEqual(['c']);
    expect(s.conflicted.map((i) => i.id)).toEqual(['d']);
    expect(s.failed).toEqual([{ id: 'e', outcome: 'failed', message: 'x' }]);
  });
  it('時刻は日本時間、+09:00 と Z を同じ時刻として扱う。空欄は（空欄）', () => {
    expect(formatEditTime('2026-09-26T03:00:00Z')).toBe(formatEditTime('2026-09-26T12:00:00+09:00'));
    expect(formatEditTime('bad')).toBe('bad');
    expect(formatEditValue('')).toBe('（空欄）');
    expect(formatEditValue(null)).toBe('（空欄）');
    expect(formatEditValue('x')).toBe('x');
  });
});

describe('usePendingRequestId', () => {
  it('同じ内容なら同じ requestId、内容が変わるか clear したら新しい requestId', () => {
    const { result } = renderHook(() => usePendingRequestId());
    const a1 = result.current.requestIdFor('k1');
    expect(result.current.requestIdFor('k1')).toBe(a1);
    const b = result.current.requestIdFor('k2');
    expect(b).not.toBe(a1);
    result.current.clear();
    expect(result.current.requestIdFor('k2')).not.toBe(b);
    expect(a1).toMatch(/^[0-9a-f-]{36}$/);
  });
});
