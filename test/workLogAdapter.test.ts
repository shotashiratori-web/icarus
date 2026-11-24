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

const { loadWorkLogDraft, clearWorkLogDraft, saveWorkLogDraft } = vi.hoisted(() => ({
  loadWorkLogDraft: vi.fn(),
  clearWorkLogDraft: vi.fn(),
  saveWorkLogDraft: vi.fn(),
}));
vi.mock('../src/db/localDB', () => ({ loadWorkLogDraft, clearWorkLogDraft, saveWorkLogDraft }));

const { createUploadAndFinalizeAsset } = vi.hoisted(() => ({ createUploadAndFinalizeAsset: vi.fn() }));
vi.mock('../src/api/photoAssetApi', () => ({ createUploadAndFinalizeAsset }));

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
    saveWorkLogDraft.mockReset().mockResolvedValue(undefined);
    createUploadAndFinalizeAsset.mockReset();
  });

  // 作業ログの写真を R2 へ（icarus_work_log_photo_r2_design.md）
  const ORIGINAL = {
    assetRequestId: 'asset-req-1', base64: 'ORIGINALBASE64', mimeType: 'image/heic', fileHash: 'c'.repeat(64),
    sizeBytes: 5_400_000, width: 4032, height: 3024, takenAt: '2026-11-25T01:00:00.000Z', fileName: 'IMG_0001.HEIC',
  };

  it('原本あり: 先に原本を R2 へ上げ、assetId を下書きに書き戻し、/work には photoAssetId だけを送る', async () => {
    loadWorkLogDraft.mockResolvedValue({ ...DRAFT_CREATE, photoBase64: 'RESIZED', photoMimeType: 'image/jpeg', photoOriginal: ORIGINAL });
    createUploadAndFinalizeAsset.mockResolvedValue('asset-1');
    submitWork.mockResolvedValue({ status: 'success', workId: '20261125-001', row: 2, photoUrl: 'https://x/assets/asset-1/view' });

    const adapter = await getAdapter();
    await adapter.submit({ requestId: 'req-1' }, 'token');

    expect(createUploadAndFinalizeAsset).toHaveBeenCalledWith(expect.objectContaining({
      requestId: 'asset-req-1', fileHash: 'c'.repeat(64), mimeType: 'image/heic', sizeBytes: 5_400_000,
      width: 4032, height: 3024, originalFilename: 'IMG_0001.HEIC', exifGpsLat: null, exifGpsLng: null,
    }), 'ORIGINALBASE64', 'token');
    const saved = saveWorkLogDraft.mock.calls[0][0];
    expect(saved.photoAssetId).toBe('asset-1');
    expect(saved.photoOriginal).toBeUndefined();
    const sent = submitWork.mock.calls[0][0];
    expect(sent.photoAssetId).toBe('asset-1');
    expect(sent.photoBase64).toBeUndefined();
    expect(sent.photoMimeType).toBeUndefined();
  });

  it('assetId が既にある（再送）: 原本を上げ直さず photoAssetId を送る', async () => {
    loadWorkLogDraft.mockResolvedValue({ ...DRAFT_CREATE, photoBase64: 'RESIZED', photoMimeType: 'image/jpeg', photoAssetId: 'asset-1' });
    submitWork.mockResolvedValue({ status: 'success', workId: '20261125-001', row: 2, photoUrl: '' });

    const adapter = await getAdapter();
    await adapter.submit({ requestId: 'req-1' }, 'token');

    expect(createUploadAndFinalizeAsset).not.toHaveBeenCalled();
    expect(submitWork.mock.calls[0][0].photoAssetId).toBe('asset-1');
    expect(submitWork.mock.calls[0][0].photoBase64).toBeUndefined();
  });

  it('原本の upload が失敗: /work を呼ばず、下書きも消さない', async () => {
    loadWorkLogDraft.mockResolvedValue({ ...DRAFT_CREATE, photoBase64: 'RESIZED', photoMimeType: 'image/jpeg', photoOriginal: ORIGINAL });
    createUploadAndFinalizeAsset.mockRejectedValue(new Error('R2への写真アップロード通信に失敗しました'));

    const adapter = await getAdapter();
    await expect(adapter.submit({ requestId: 'req-1' }, 'token')).rejects.toThrow();
    expect(submitWork).not.toHaveBeenCalled();
    expect(clearWorkLogDraft).not.toHaveBeenCalled();
  });

  it('原本なし（古い下書き）: 今まで通り縮小 JPEG を photoBase64 で送る', async () => {
    loadWorkLogDraft.mockResolvedValue({ ...DRAFT_CREATE, photoBase64: 'RESIZED', photoMimeType: 'image/jpeg' });
    submitWork.mockResolvedValue({ status: 'success', workId: '20261125-001', row: 2, photoUrl: '' });

    const adapter = await getAdapter();
    await adapter.submit({ requestId: 'req-1' }, 'token');

    expect(createUploadAndFinalizeAsset).not.toHaveBeenCalled();
    const sent = submitWork.mock.calls[0][0];
    expect(sent.photoBase64).toBe('RESIZED');
    expect(sent.photoAssetId).toBeUndefined();
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
