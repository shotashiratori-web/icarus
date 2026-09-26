import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  adjustForLargeCategory,
  choicesFor,
  diffValues,
  historyForDisplay,
  rebaseAfterConflict,
  toggleObservedPart,
  validateEditValues,
} from '../src/utils/fieldEntryEdit';
import { patchFieldEntry, fetchFieldEntryDetail, FieldEditConflictError } from '../src/api/fieldEntryEditApi';
import { TokenExpiredError } from '../src/api/icarusApi';
import type { FieldEditOption, FieldEditValues, FieldEntryHistoryItem } from '../src/types/fieldEntryEdit';

const base: FieldEditValues = {
  food: 'ナラタケ', date: '2026-09-19', place: '余市', memo: '', large_category: 'キノコ', sub_category: '不明',
  phase: '幼菌', harvested: 'あり', identification_status: '未確認', observed_parts: ['全体'], subject_type: '食材',
};

const opt = (field: FieldEditOption['field'], value: string, parentValue: string | null = null, isActive = true, sortOrder = 10): FieldEditOption =>
  ({ field, value, label: value, parentValue, sortOrder, isActive });

const options: FieldEditOption[] = [
  opt('large_category', 'キノコ'), opt('large_category', '植物', null, true, 20),
  opt('sub_category', '山菜', '植物'), opt('sub_category', '不明', null, true, 99),
  opt('phase', '幼菌', 'キノコ'), opt('phase', '成菌（傘開き）', 'キノコ', true, 20),
  opt('record_type', '食材'), opt('record_type', '加工品', null, false, 40),
  opt('observed_part', '花'), opt('observed_part', '全体', null, true, 40),
];

describe('diffValues', () => {
  it('変えた項目だけを返す（食材名・日付の前後空白だけの違いは変更にしない）', () => {
    expect(diffValues(base, { ...base, food: ' ナラタケ ', memo: '傘が大きい', observed_parts: ['全体', '花'] }))
      .toEqual({ memo: '傘が大きい', observed_parts: ['全体', '花'] });
    expect(diffValues(base, { ...base })).toEqual({});
  });
});

describe('rebaseAfterConflict（409の後）', () => {
  it('自分が変えていない項目は最新値、自分が変えた項目は自分の値。両方が変えた項目はoverlapに出す', () => {
    const form = { ...base, memo: '自分のメモ', place: '自分の場所' };
    const latest = { ...base, memo: '他の人のメモ', identification_status: '推定' };
    const r = rebaseAfterConflict(base, form, latest);
    expect(r.values).toMatchObject({ memo: '自分のメモ', place: '自分の場所', identification_status: '推定' });
    expect(r.mine).toEqual(['place', 'memo']);
    expect(r.overlap).toEqual(['memo']);
  });

  it('相手が同じ値に変えていた項目はoverlapにしない', () => {
    const r = rebaseAfterConflict(base, { ...base, memo: 'x' }, { ...base, memo: 'x' });
    expect(r.overlap).toEqual([]);
    expect(diffValues({ ...base, memo: 'x' }, r.values)).toEqual({});
  });
});

describe('choicesFor / adjustForLargeCategory', () => {
  it('有効な選択肢のうち大分類に合うものだけ。今の値が無効化されていても先頭に残す', () => {
    expect(choicesFor('phase', options, 'キノコ', '幼菌').map((c) => c.value)).toEqual(['幼菌', '成菌（傘開き）']);
    expect(choicesFor('phase', options, '植物', '')).toEqual([]);
    expect(choicesFor('sub_category', options, '植物', '').map((c) => c.value)).toEqual(['山菜', '不明']);
    expect(choicesFor('subject_type', options, '', '加工品')[0]).toEqual({ value: '加工品', label: '加工品', inactive: true });
  });

  it('大分類を変えると、合わない小分類は「不明」、合わないフェーズは空欄になる', () => {
    const next = adjustForLargeCategory({ ...base, large_category: '植物', sub_category: '山菜', phase: '幼菌' }, options);
    expect(next).toMatchObject({ sub_category: '山菜', phase: '' });
    const back = adjustForLargeCategory({ ...base, large_category: 'キノコ', sub_category: '山菜' }, options);
    expect(back.sub_category).toBe('不明');
  });
});

describe('toggleObservedPart / validateEditValues / historyForDisplay', () => {
  it('観察部位は元の並びを保って付け外しする', () => {
    expect(toggleObservedPart(['花', '全体'], '花')).toEqual(['全体']);
    expect(toggleObservedPart(['全体'], '花')).toEqual(['全体', '花']);
  });

  it('食材名の空・無題、実在しない日付はエラー', () => {
    expect(validateEditValues(base)).toEqual({});
    expect(validateEditValues({ ...base, food: ' ' }).food).toBeTruthy();
    expect(validateEditValues({ ...base, food: '無題' }).food).toBeTruthy();
    expect(validateEditValues({ ...base, date: '2026-02-30' }).date).toBeTruthy();
  });

  it('履歴は新しい順、余市節気IDは出さない', () => {
    const item = (id: string, changes: FieldEntryHistoryItem['changes']): FieldEntryHistoryItem =>
      ({ id, editedAt: '2026-09-26T00:00:00Z', editedBy: 'a', editedByName: 'A', source: 'system', reason: null, bulkId: null, derived: true, changes });
    const out = historyForDisplay([
      item('1', [{ field: 'memo', old: '', new: 'x' }]),
      item('2', [{ field: 'yoichi_season_id', old: 'seika', new: 'mukoubana' }, { field: 'kigo', old: '盛夏', new: '向花' }]),
      item('3', [{ field: 'yoichi_season_id', old: null, new: 'seika' }]),
    ]);
    expect(out.map((i) => i.id)).toEqual(['2', '1']);
    expect(out[0].changes.map((c) => c.field)).toEqual(['kigo']);
  });
});

describe('fieldEntryEditApi', () => {
  afterEach(() => vi.unstubAllGlobals());

  const stubFetch = (status: number, body: unknown) => {
    const fn = vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status }));
    vi.stubGlobal('fetch', fn);
    return fn;
  };

  it('PATCHはrequestId・expectedUpdatedAt・変えた項目だけを送る', async () => {
    const fn = stubFetch(200, { status: 'success', outcome: 'applied' });
    const outcome = await patchFieldEntry('ev 1', { requestId: 'r1', expectedUpdatedAt: 't1', changes: { memo: 'x' } }, 'tok');
    expect(outcome).toBe('applied');
    const [url, init] = fn.mock.calls[0];
    expect(url).toMatch(/\/field\/entries\/ev%201$/);
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(init.body)).toEqual({ requestId: 'r1', expectedUpdatedAt: 't1', changes: { memo: 'x' } });
    expect(init.headers.Authorization).toBe('Bearer tok');
  });

  it('409はFieldEditConflictError、401はTokenExpiredError、400はWorkerのメッセージ', async () => {
    stubFetch(409, { status: 'error', code: 'EDIT_CONFLICT', message: 'm' });
    await expect(patchFieldEntry('e', { requestId: 'r', expectedUpdatedAt: 't', changes: {} }, 'tok')).rejects.toBeInstanceOf(FieldEditConflictError);
    stubFetch(401, { status: 'error' });
    await expect(patchFieldEntry('e', { requestId: 'r', expectedUpdatedAt: 't', changes: {} }, 'tok')).rejects.toBeInstanceOf(TokenExpiredError);
    stubFetch(400, { status: 'error', code: 'EDIT_VALIDATION', message: '食材名は空にできません' });
    await expect(patchFieldEntry('e', { requestId: 'r', expectedUpdatedAt: 't', changes: {} }, 'tok')).rejects.toThrow('食材名は空にできません');
  });

  it('詳細の観察部位はカンマ区切りを配列にし、subject_typeのnullは空文字にする', async () => {
    stubFetch(200, { status: 'success', entry: { event_id: 'e', food: 'f', observed_parts: '花, 未熟果', subject_type: null, updated_at: 't' } });
    const d = await fetchFieldEntryDetail('e', 'tok');
    expect(d).toMatchObject({ eventId: 'e', observed_parts: ['花', '未熟果'], subject_type: '', updatedAt: 't' });
  });
});
