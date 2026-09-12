import { describe, expect, it, vi, beforeEach } from 'vitest';

// Work Log Submission Framework Final Design。workLogAdapterのsubmit()を検証する。
// - payloadはidentity（requestId）のみ。実データはwork_log_draftから読み直す
// - 成功時：draft clear（GAS成功確定後にのみ消す）
// - draft不存在：invariant違反時のno-op契約（API送信せずresolvedを返す）
// 実際のfetch/IndexedDBには触れず、api/workApi・db/localDBをmockする。

const { submitWork } = vi.hoisted(() => ({ submitWork: vi.fn() }));
vi.mock('../src/api/workApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/api/workApi')>();
  return { ...actual, submitWork };
});

const { loadWorkLogDraft, clearWorkLogDraft } = vi.hoisted(() => ({
  loadWorkLogDraft: vi.fn(),
  clearWorkLogDraft: vi.fn(),
}));
vi.mock('../src/db/localDB', () => ({ loadWorkLogDraft, clearWorkLogDraft }));

async function getAdapter() {
  await import('../src/submission/adapters/workLogAdapter');
  const { getAdapter } = await import('../src/submission/registry');
  return getAdapter('workLog');
}

const DRAFT_CREATE = {
  key: 'work:req-1', requestId: 'req-1', mode: 'create' as const,
  title: 'タイトル', type: '加工研究', content: '内容',
  datetime: '2026-09-12T10:00', caption: '', savedAt: '2026-09-12T10:00:00.000Z',
};

describe('workLogAdapter.submit', () => {
  beforeEach(() => {
    submitWork.mockReset();
    loadWorkLogDraft.mockReset();
    clearWorkLogDraft.mockReset().mockResolvedValue(undefined);
  });

  it('draftから読み直したcreate内容でsubmitWorkを呼ぶ', async () => {
    loadWorkLogDraft.mockResolvedValue(DRAFT_CREATE);
    submitWork.mockResolvedValue({ status: 'success', workId: '20260912-001', row: 2, photoUrl: '' });

    const adapter = await getAdapter();
    const result = await adapter.submit({ requestId: 'req-1' }, 'token');

    expect(submitWork).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: 'req-1', action: 'create', title: 'タイトル', type: '加工研究', content: '内容',
      }),
      'token',
    );
    expect(result).toEqual({ status: 'success', workId: '20260912-001', row: 2, photoUrl: '' });
  });

  it('appendの場合はtitle/typeを送らずworkIdを送る', async () => {
    loadWorkLogDraft.mockResolvedValue({
      ...DRAFT_CREATE, mode: 'append' as const, workId: '20260912-001', title: undefined, type: undefined,
    });
    submitWork.mockResolvedValue({ status: 'success', workId: '20260912-001', row: 3, photoUrl: '' });

    const adapter = await getAdapter();
    await adapter.submit({ requestId: 'req-1' }, 'token');

    const sentPayload = submitWork.mock.calls[0][0];
    expect(sentPayload.action).toBe('append');
    expect(sentPayload.workId).toBe('20260912-001');
    expect(sentPayload.title).toBeUndefined();
    expect(sentPayload.type).toBeUndefined();
  });

  it('GAS成功確定後にのみdraftをclearする', async () => {
    loadWorkLogDraft.mockResolvedValue(DRAFT_CREATE);
    submitWork.mockResolvedValue({ status: 'success', workId: '20260912-001', row: 2, photoUrl: '' });

    const adapter = await getAdapter();
    await adapter.submit({ requestId: 'req-1' }, 'token');

    expect(clearWorkLogDraft).toHaveBeenCalledWith('req-1');
  });

  it('submitWorkが失敗した場合はdraftをclearしない（次回retryの元データを残す）', async () => {
    loadWorkLogDraft.mockResolvedValue(DRAFT_CREATE);
    submitWork.mockRejectedValue(new Error('通信エラー'));

    const adapter = await getAdapter();
    await expect(adapter.submit({ requestId: 'req-1' }, 'token')).rejects.toThrow('通信エラー');

    expect(clearWorkLogDraft).not.toHaveBeenCalled();
  });

  it('draft不存在: API送信せずresolvedを返す（invariant違反時のno-op契約）', async () => {
    loadWorkLogDraft.mockResolvedValue(undefined);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const adapter = await getAdapter();
    const result = await adapter.submit({ requestId: 'missing-req' }, 'token');

    expect(submitWork).not.toHaveBeenCalled();
    expect(result).toBeUndefined();
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});
