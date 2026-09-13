import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { SubmissionItem } from '../src/submission/types';

// Work Log Submission Framework Final Design（PR2）③。resendAll()自身にin-flight guardを
// 追加したことで、App起動時／online復帰／手動「すべて再送」が同時に発火しても実処理は1回だけに
// なることを検証する。あわせて、Food Log/Field Log D1/Work Logいずれのpending項目も
// 自動再送の対象になる（Work Logだけの専用retryを作っていない）ことも確認する。
// 実際のfetch/IndexedDBには触れず、queueDBをmockして完結させる

const { listAll, get, put, remove } = vi.hoisted(() => ({
  listAll: vi.fn(),
  get: vi.fn(),
  put: vi.fn(),
  remove: vi.fn(),
}));

vi.mock('../src/submission/queueDB', () => ({ listAll, get, put, remove }));

function makeItem(overrides: Partial<SubmissionItem>): SubmissionItem {
  return {
    id: overrides.id ?? 'item-1',
    entity: 'fieldLogD1',
    state: 'pending',
    payload: {},
    title: 'テスト',
    createdAt: '2026-09-13T00:00:00.000Z',
    updatedAt: '2026-09-13T00:00:00.000Z',
    attempts: 1,
    ...overrides,
  };
}

// listAllにわずかな遅延を挟むことで、同期的に連続呼び出したresendAll()同士が実際に
// 時間軸上で重なるようにする（遅延が無いと「たまたま重ならなかった」だけの偽陰性になりうる）
function delayedListAll<T>(value: T, ms = 5): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms));
}

async function setup() {
  vi.resetModules();
  const { registerAdapter } = await import('../src/submission/registry');
  const submit = vi.fn().mockResolvedValue(undefined);
  const mapError = () => ({
    code: 'SERVER_ERROR' as const, title: '', description: '', retryable: true,
    timestamp: '', entity: 'fieldLogD1' as const, payloadId: '',
  });
  registerAdapter({ entity: 'fieldLogD1', submit, mapError });
  registerAdapter({ entity: 'foodLog', submit, mapError });
  registerAdapter({ entity: 'workLog', submit, mapError });
  const { resendAll } = await import('../src/submission/orchestrator');
  return { resendAll, submit };
}

describe('resendAll: concurrency guard', () => {
  beforeEach(() => {
    listAll.mockReset();
    get.mockReset();
    put.mockResolvedValue(undefined);
    remove.mockResolvedValue(undefined);
  });

  it('startup effectとonline effectがほぼ同時に発火しても、実処理（queueDB.listAll）は1回だけ', async () => {
    const item = makeItem({ id: 'a' });
    listAll.mockImplementation(() => delayedListAll([item]));
    get.mockResolvedValue(item);

    const { resendAll, submit } = await setup();

    // 起動時effectとonline effectが同一tickでほぼ同時にresendAll()を呼ぶ状況を模す
    const [r1, r2] = await Promise.all([resendAll('token'), resendAll('token')]);

    expect(listAll).toHaveBeenCalledTimes(1);
    expect(submit).toHaveBeenCalledTimes(1);
    expect(r1).toBe(r2); // 同じ実行結果に相乗りしている
  });

  it('online連打（3回連続）でも実処理は1回だけ', async () => {
    const item = makeItem({ id: 'a' });
    listAll.mockImplementation(() => delayedListAll([item]));
    get.mockResolvedValue(item);

    const { resendAll, submit } = await setup();

    await Promise.all([resendAll('token'), resendAll('token'), resendAll('token')]);

    expect(listAll).toHaveBeenCalledTimes(1);
    expect(submit).toHaveBeenCalledTimes(1);
  });

  it('1回目の実行が完了した後の新規呼び出しは、新しく実処理が走る（相乗りしたままにならない）', async () => {
    const item = makeItem({ id: 'a' });
    listAll.mockImplementation(() => delayedListAll([item]));
    get.mockResolvedValue(item);

    const { resendAll, submit } = await setup();

    await resendAll('token');
    await resendAll('token');

    expect(listAll).toHaveBeenCalledTimes(2);
    expect(submit).toHaveBeenCalledTimes(2);
  });

  it('Food Log / Field Log D1 / Work Log、いずれのpending項目も自動再送の対象になる', async () => {
    const items = [
      makeItem({ id: 'food-1', entity: 'foodLog' }),
      makeItem({ id: 'field-1', entity: 'fieldLogD1' }),
      makeItem({ id: 'work-1', entity: 'workLog' }),
    ];
    listAll.mockResolvedValue(items);
    get.mockImplementation((id: string) => Promise.resolve(items.find((i) => i.id === id)));

    const { resendAll, submit } = await setup();
    const result = await resendAll('token');

    expect(submit).toHaveBeenCalledTimes(3);
    expect(result).toEqual({ succeeded: 3, stillPending: 0 });
  });
});
