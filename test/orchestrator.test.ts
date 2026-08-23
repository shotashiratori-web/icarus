import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { SubmissionItem } from '../src/submission/types';

// Stage 1A: retryable:falseの保留項目（例: ASSET_UNSUPPORTED_MIME_TYPE）が
// resendAll（「すべて再送」）の対象から正しく除外されることを検証する。
// IndexedDBには触れず、queueDBをmockして完結させる

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
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    attempts: 1,
    ...overrides,
  };
}

async function setup() {
  vi.resetModules();
  const { registerAdapter } = await import('../src/submission/registry');
  const submit = vi.fn().mockResolvedValue(undefined);
  registerAdapter({
    entity: 'fieldLogD1',
    submit,
    mapError: (err) => ({
      code: 'SERVER_ERROR',
      title: '', description: '', retryable: true,
      timestamp: '', entity: 'fieldLogD1', payloadId: '',
      technicalDetail: String(err),
    }),
  });
  const { resendAll } = await import('../src/submission/orchestrator');
  return { resendAll, submit };
}

describe('resendAll: retryable分類によるqueueの再送対象制御', () => {
  beforeEach(() => {
    listAll.mockReset();
    get.mockReset();
    put.mockResolvedValue(undefined);
    remove.mockResolvedValue(undefined);
  });

  it('2. retryable=falseの項目（unsupported MIME相当）は再送対象にならない', async () => {
    const nonRetryable = makeItem({
      id: 'heic-1',
      lastError: {
        code: 'UNSUPPORTED_MEDIA_TYPE', title: '', description: '', retryable: false,
        timestamp: '2026-08-01T00:00:00.000Z', entity: 'fieldLogD1', payloadId: 'heic-1',
      },
    });
    listAll.mockResolvedValue([nonRetryable]);
    get.mockResolvedValue(nonRetryable);

    const { resendAll, submit } = await setup();
    const result = await resendAll('token');

    expect(submit).not.toHaveBeenCalled();
    expect(result).toEqual({ succeeded: 0, stillPending: 1 });
  });

  it('5. JPEG正常経路（lastErrorなし/retryable=true）は従来通り再送される（回帰なし）', async () => {
    const retryableItem = makeItem({
      id: 'jpeg-1',
      lastError: {
        code: 'NETWORK_ERROR', title: '', description: '', retryable: true,
        timestamp: '2026-08-01T00:00:00.000Z', entity: 'fieldLogD1', payloadId: 'jpeg-1',
      },
    });
    listAll.mockResolvedValue([retryableItem]);
    get.mockResolvedValue(retryableItem);

    const { resendAll, submit } = await setup();
    const result = await resendAll('token');

    expect(submit).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ succeeded: 1, stillPending: 0 });
  });

  it('混在時: retryable=falseだけ除外し、他は通常通り再送する', async () => {
    const nonRetryable = makeItem({
      id: 'heic-2',
      lastError: {
        code: 'UNSUPPORTED_MEDIA_TYPE', title: '', description: '', retryable: false,
        timestamp: '2026-08-01T00:00:00.000Z', entity: 'fieldLogD1', payloadId: 'heic-2',
      },
    });
    const retryable = makeItem({ id: 'ok-1' });
    listAll.mockResolvedValue([nonRetryable, retryable]);
    get.mockImplementation((id: string) => Promise.resolve(id === 'heic-2' ? nonRetryable : retryable));

    const { resendAll, submit } = await setup();
    const result = await resendAll('token');

    expect(submit).toHaveBeenCalledTimes(1);
    expect(submit).toHaveBeenCalledWith(retryable.payload, 'token');
    expect(result).toEqual({ succeeded: 1, stillPending: 1 });
  });
});
