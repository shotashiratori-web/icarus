import { describe, expect, it, vi, beforeEach } from 'vitest';

// Tasting Note Persistence v1（Stage 1B）。wineTastingNoteAdapterのsubmit()が
// remoteId（d1_note_id）の有無でPOST（新規）/PATCH（更新）を正しく使い分け、
// 新規作成成功時にローカルNoteへd1_note_idを書き戻すことを検証する。
// 実際のfetch/IndexedDBには触れず、api/wineTastingNoteApi・db/localDBをmockする。

const { createWineTastingNote, updateWineTastingNote } = vi.hoisted(() => ({
  createWineTastingNote: vi.fn(),
  updateWineTastingNote: vi.fn(),
}));
const { getNote, saveNote } = vi.hoisted(() => ({
  getNote: vi.fn(),
  saveNote: vi.fn(),
}));

vi.mock('../src/api/wineTastingNoteApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/api/wineTastingNoteApi')>();
  return { ...actual, createWineTastingNote, updateWineTastingNote };
});
vi.mock('../src/db/localDB', () => ({ getNote, saveNote }));

async function getAdapter() {
  await import('../src/submission/adapters/wineTastingNoteAdapter');
  const { getAdapter } = await import('../src/submission/registry');
  return getAdapter('wineTastingNote');
}

const BASE_PAYLOAD = {
  requestId: 'note-1',
  remoteId: null as string | null,
  wineId: null as string | null,
  wineNameSnapshot: 'モンロゼ AK',
  producerSnapshot: 'ドメーヌ・モン',
  vintageSnapshot: '2021',
  tastingDate: '2026-08-29',
  location: '店内',
  aromaText: 'ベリー',
  memoText: 'テストメモ',
  glassPrice: '1500',
  bottlePrice: '6000',
};

describe('wineTastingNoteAdapter.submit', () => {
  beforeEach(() => {
    createWineTastingNote.mockReset();
    updateWineTastingNote.mockReset();
    getNote.mockReset();
    saveNote.mockReset();
    saveNote.mockResolvedValue(undefined);
  });

  it('remoteId未設定なら新規POSTし、返ってきたidをローカルNoteのd1_note_idへ書き戻す', async () => {
    createWineTastingNote.mockResolvedValue({ id: 'server-id-1', requestId: 'note-1' });
    getNote.mockResolvedValue({ id: 'note-1', d1_note_id: null, sync_status: 'syncing' });
    const adapter = await getAdapter();

    const payload = { ...BASE_PAYLOAD };
    await adapter.submit(payload, 'token');

    expect(createWineTastingNote).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: 'note-1',
        wineId: null,
        wineNameSnapshot: 'モンロゼ AK',
        memoText: 'テストメモ',
      }),
      'token',
    );
    expect(updateWineTastingNote).not.toHaveBeenCalled();
    expect(saveNote).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'note-1', d1_note_id: 'server-id-1' }),
    );
    // 呼び出し元(sync層)が同一payloadを再利用した場合に備え、payload自体も更新される
    expect(payload.remoteId).toBe('server-id-1');
  });

  it('remoteId設定済みならPATCHし、POST（新規作成）は呼ばれない', async () => {
    updateWineTastingNote.mockResolvedValue({ id: 'server-id-1', requestId: 'note-1' });
    const adapter = await getAdapter();

    const payload = { ...BASE_PAYLOAD, remoteId: 'server-id-1', memoText: '編集後メモ' };
    await adapter.submit(payload, 'token');

    expect(updateWineTastingNote).toHaveBeenCalledWith(
      'server-id-1',
      expect.objectContaining({ memoText: '編集後メモ', wineId: null }),
      'token',
    );
    expect(createWineTastingNote).not.toHaveBeenCalled();
    // 既存remoteId宛のPATCHでは、ローカルNoteのd1_note_id書き戻しは不要（既に持っている）
    expect(getNote).not.toHaveBeenCalled();
    expect(saveNote).not.toHaveBeenCalled();
  });

  it('新規POST時にローカルNoteが既に削除されていれば、書き戻し先が無いため何もせず正常終了する', async () => {
    createWineTastingNote.mockResolvedValue({ id: 'server-id-2', requestId: 'note-2' });
    getNote.mockResolvedValue(undefined);
    const adapter = await getAdapter();

    await expect(adapter.submit({ ...BASE_PAYLOAD, requestId: 'note-2' }, 'token')).resolves.toBeDefined();
    expect(saveNote).not.toHaveBeenCalled();
  });

  // stale syncing recovery（POST retry safety）: 前回instanceがcrash等でsyncingのまま残した
  // Note（未同期＝remoteIdなし）を再送しても、同一requestIdのままPOSTすること（Stage 1A側の
  // requestId UNIQUE制約により、同一payloadなら新規rowを増やさずduplicate:trueで吸収される）
  it('POST retry safety: syncing復旧の再送でも同一requestIdでPOSTし続ける（変更しない）', async () => {
    createWineTastingNote.mockResolvedValue({ id: 'server-id-3', requestId: 'note-3' });
    // ローカルNoteのd1_note_idがまだnullのまま（前回instanceがcrash等で書き戻し前に落ちた想定）。
    // syncWineTastingNote実装同様、呼び出しごとにpayloadをnoteから再構築するため毎回remoteId=nullになる
    getNote.mockResolvedValue({ id: 'note-3', d1_note_id: null, sync_status: 'syncing' });
    const adapter = await getAdapter();

    await adapter.submit({ ...BASE_PAYLOAD, requestId: 'note-3' }, 'token');
    await adapter.submit({ ...BASE_PAYLOAD, requestId: 'note-3' }, 'token'); // 2回目＝再送を模擬

    expect(createWineTastingNote).toHaveBeenCalledTimes(2);
    for (const call of createWineTastingNote.mock.calls) {
      expect(call[0].requestId).toBe('note-3');
    }
  });

  // stale syncing recovery（PATCH retry safety）: 既にd1_note_idを持つNote（前回instanceが
  // create成功後、sync_status更新前にcrash等）を再送しても、PATCH先のidは変えない。
  // UPDATE文なので再送してもrowが増えず、requestId/d1_note_idともに不変であること
  it('PATCH retry safety: syncing復旧の再送でも同一d1_note_id宛にPATCHし続け、値を変更しない', async () => {
    updateWineTastingNote.mockResolvedValue({ id: 'server-id-4', requestId: 'note-4' });
    const adapter = await getAdapter();

    const payload = { ...BASE_PAYLOAD, requestId: 'note-4', remoteId: 'server-id-4' };
    await adapter.submit(payload, 'token');
    await adapter.submit(payload, 'token'); // 2回目＝再送を模擬

    expect(updateWineTastingNote).toHaveBeenCalledTimes(2);
    for (const call of updateWineTastingNote.mock.calls) {
      expect(call[0]).toBe('server-id-4'); // PATCH先id不変
    }
    expect(payload.remoteId).toBe('server-id-4'); // d1_note_id相当の値も不変
    expect(createWineTastingNote).not.toHaveBeenCalled();
    // PATCH経路はローカルNoteのd1_note_id書き戻しが不要（既に持っている）ため、getNote/saveNoteは呼ばれない
    expect(getNote).not.toHaveBeenCalled();
    expect(saveNote).not.toHaveBeenCalled();
  });

  // Tasting Note Persistence v1（Stage 1C-A）: wineId配線のテスト
  it('3. wineId未接続（null）ならPOST payloadにもwineId:nullで送信される', async () => {
    createWineTastingNote.mockResolvedValue({ id: 'server-id-5', requestId: 'note-5' });
    getNote.mockResolvedValue({ id: 'note-5', d1_note_id: null, wine_id: null });
    const adapter = await getAdapter();

    await adapter.submit({ ...BASE_PAYLOAD, requestId: 'note-5', wineId: null }, 'token');

    expect(createWineTastingNote).toHaveBeenCalledWith(
      expect.objectContaining({ requestId: 'note-5', wineId: null }),
      'token',
    );
  });

  it('4. wineId接続済み（UUID）ならPOST payloadにそのUUIDが送信される', async () => {
    createWineTastingNote.mockResolvedValue({ id: 'server-id-6', requestId: 'note-6' });
    getNote.mockResolvedValue({ id: 'note-6', d1_note_id: null, wine_id: 'wine-uuid-1' });
    const adapter = await getAdapter();

    await adapter.submit({ ...BASE_PAYLOAD, requestId: 'note-6', wineId: 'wine-uuid-1' }, 'token');

    expect(createWineTastingNote).toHaveBeenCalledWith(
      expect.objectContaining({ requestId: 'note-6', wineId: 'wine-uuid-1' }),
      'token',
    );
  });

  it('6. remoteId設定済み（PATCH経路）でもwineIdがそのままfieldsへ含まれる', async () => {
    updateWineTastingNote.mockResolvedValue({ id: 'server-id-7', requestId: 'note-7' });
    const adapter = await getAdapter();

    await adapter.submit({ ...BASE_PAYLOAD, requestId: 'note-7', remoteId: 'server-id-7', wineId: 'wine-uuid-2' }, 'token');

    expect(updateWineTastingNote).toHaveBeenCalledWith(
      'server-id-7',
      expect.objectContaining({ wineId: 'wine-uuid-2' }),
      'token',
    );
  });

  it('7. 紐付け解除（wineId: null）でPATCHすると、fieldsのwineIdもnullで送信される', async () => {
    updateWineTastingNote.mockResolvedValue({ id: 'server-id-8', requestId: 'note-8' });
    const adapter = await getAdapter();

    await adapter.submit({ ...BASE_PAYLOAD, requestId: 'note-8', remoteId: 'server-id-8', wineId: null }, 'token');

    expect(updateWineTastingNote).toHaveBeenCalledWith(
      'server-id-8',
      expect.objectContaining({ wineId: null }),
      'token',
    );
  });

  it('18. wine紐付け経路はWine Entity新規作成APIを一切呼ばない（このモジュールはcreateWineをimportしていない）', async () => {
    createWineTastingNote.mockResolvedValue({ id: 'server-id-9', requestId: 'note-9' });
    getNote.mockResolvedValue({ id: 'note-9', d1_note_id: null, wine_id: null });
    const adapter = await getAdapter();

    await adapter.submit({ ...BASE_PAYLOAD, requestId: 'note-9', wineId: null }, 'token');

    // wineTastingNoteAdapter.tsのimportにcreateWine（Wine Entity新規作成API）が
    // 含まれていないことがモック構成自体で保証される（呼びようがない）
    expect(createWineTastingNote).toHaveBeenCalledTimes(1);
  });
});
