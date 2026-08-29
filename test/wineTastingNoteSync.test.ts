import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import type { WineNote } from '../src/types/wine';
import { emptyField } from '../src/types/wine';

// Tasting Note Persistence v1（Stage 1B）。syncWineTastingNote/retryPendingWineTastingNotesの
// sync_status遷移（local→syncing→synced/failed）と、未ログイン/オフライン時に何もしないことを検証する。
// Submission Framework本体（submitWithFallback）とIndexedDB（localDB）はmockして分離する。

const { submitWithFallback } = vi.hoisted(() => ({ submitWithFallback: vi.fn() }));
const { getAllNotes, getNote, saveNote } = vi.hoisted(() => ({
  getAllNotes: vi.fn(),
  getNote: vi.fn(),
  saveNote: vi.fn(),
}));

vi.mock('../src/submission/orchestrator', () => ({ submitWithFallback }));
vi.mock('../src/db/localDB', () => ({ getAllNotes, getNote, saveNote }));

function makeNote(overrides: Partial<WineNote>): WineNote {
  return {
    id: 'note-1',
    fields: {
      wine_name: { ...emptyField(), text: 'モンロゼ AK' },
      producer: emptyField(),
      vintage: emptyField(),
      type: emptyField(),
      tasting_date: emptyField(),
      location: emptyField(),
      aroma: emptyField(),
      memo: emptyField(),
      glass_price: emptyField(),
      bottle_price: emptyField(),
    },
    label_photo_url: null,
    addenda: [],
    created_at: '2026-08-29T00:00:00.000Z',
    updated_at: '2026-08-29T00:00:00.000Z',
    sync_status: 'local',
    notion_page_id: null,
    d1_note_id: null,
    ...overrides,
  };
}

describe('syncWineTastingNote', () => {
  const originalOnLine = navigator.onLine;

  beforeEach(() => {
    submitWithFallback.mockReset();
    getAllNotes.mockReset();
    getNote.mockReset();
    saveNote.mockReset();
    saveNote.mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
  });

  afterEach(() => {
    Object.defineProperty(navigator, 'onLine', { value: originalOnLine, configurable: true });
  });

  it('1/4. 未ログイン(idToken=null)なら何も送信せず、sync_statusも変更しない', async () => {
    const { syncWineTastingNote } = await import('../src/submission/wineTastingNoteSync');
    await syncWineTastingNote('note-1', null);

    expect(getNote).not.toHaveBeenCalled();
    expect(submitWithFallback).not.toHaveBeenCalled();
    expect(saveNote).not.toHaveBeenCalled();
  });

  it('3. オフラインなら何も送信しない', async () => {
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
    const { syncWineTastingNote } = await import('../src/submission/wineTastingNoteSync');
    await syncWineTastingNote('note-1', 'token');

    expect(submitWithFallback).not.toHaveBeenCalled();
  });

  it('6/7. ログイン済み+オンラインで成功時: syncing→syncedへ遷移する', async () => {
    const note = makeNote({ sync_status: 'local' });
    getNote.mockResolvedValueOnce(note).mockResolvedValueOnce(note);
    submitWithFallback.mockResolvedValue({ ok: true });

    const { syncWineTastingNote } = await import('../src/submission/wineTastingNoteSync');
    await syncWineTastingNote('note-1', 'token');

    expect(saveNote).toHaveBeenCalledWith(expect.objectContaining({ sync_status: 'syncing' }));
    expect(submitWithFallback).toHaveBeenCalledWith(
      expect.objectContaining({
        entity: 'wineTastingNote',
        itemId: 'note-1',
        idToken: 'token',
        payload: expect.objectContaining({ requestId: 'note-1', wineNameSnapshot: 'モンロゼ AK' }),
      }),
    );
    expect(saveNote).toHaveBeenLastCalledWith(expect.objectContaining({ sync_status: 'synced' }));
  });

  it('8/9. 失敗時: syncing→failedへ遷移し、Noteは削除されない（IndexedDBから消さない）', async () => {
    const note = makeNote({ sync_status: 'local' });
    getNote.mockResolvedValueOnce(note).mockResolvedValueOnce(note);
    submitWithFallback.mockResolvedValue({ ok: false, item: { ...note, state: 'pending' } });

    const { syncWineTastingNote } = await import('../src/submission/wineTastingNoteSync');
    await syncWineTastingNote('note-1', 'token');

    expect(saveNote).toHaveBeenLastCalledWith(expect.objectContaining({ sync_status: 'failed' }));
    // deleteNote等の削除系APIは一切importしていない＝呼びようがないことがモック構成自体で保証される
  });

  it('10. retry時は同じrequestId（= note.id）をpayloadに使う', async () => {
    const note = makeNote({ id: 'note-42', sync_status: 'failed' });
    getNote.mockResolvedValueOnce(note).mockResolvedValueOnce(note);
    submitWithFallback.mockResolvedValue({ ok: true });

    const { syncWineTastingNote } = await import('../src/submission/wineTastingNoteSync');
    await syncWineTastingNote('note-42', 'token');

    expect(submitWithFallback).toHaveBeenCalledWith(
      expect.objectContaining({ itemId: 'note-42', payload: expect.objectContaining({ requestId: 'note-42' }) }),
    );
  });

  it('既にsynced中のNoteは再送しない（送信済み内容を上書きしない）', async () => {
    const synced = makeNote({ sync_status: 'synced' });
    getNote.mockResolvedValue(synced);

    const { syncWineTastingNote } = await import('../src/submission/wineTastingNoteSync');
    await syncWineTastingNote('note-1', 'token');

    expect(submitWithFallback).not.toHaveBeenCalled();
  });

  // stale syncing recovery: syncing自体はブロック条件ではない（synced以外はすべて送信対象）。
  // 前回instanceがcrash/強制終了/reload/OS killでsyncingのまま残したNoteも、次回起動時の
  // retryPendingWineTastingNotes(includeSyncing:true)からsyncWineTastingNoteへ普通に到達し再送される
  it('3. syncing + d1_note_idなしのNoteを直接呼ぶとPOST経路のpayload（remoteId=null）で送信する', async () => {
    const staleSyncing = makeNote({ id: 'note-stale-1', sync_status: 'syncing', d1_note_id: null });
    getNote.mockResolvedValueOnce(staleSyncing).mockResolvedValueOnce(staleSyncing);
    submitWithFallback.mockResolvedValue({ ok: true });

    const { syncWineTastingNote } = await import('../src/submission/wineTastingNoteSync');
    await syncWineTastingNote('note-stale-1', 'token');

    expect(submitWithFallback).toHaveBeenCalledWith(
      expect.objectContaining({
        itemId: 'note-stale-1',
        payload: expect.objectContaining({ requestId: 'note-stale-1', remoteId: null }),
      }),
    );
  });

  it('4. syncing + d1_note_idありのNoteを直接呼ぶとPATCH経路のpayload（remoteId=既存id）で送信する', async () => {
    const staleSyncing = makeNote({ id: 'note-stale-2', sync_status: 'syncing', d1_note_id: 'server-9' });
    getNote.mockResolvedValueOnce(staleSyncing).mockResolvedValueOnce(staleSyncing);
    submitWithFallback.mockResolvedValue({ ok: true });

    const { syncWineTastingNote } = await import('../src/submission/wineTastingNoteSync');
    await syncWineTastingNote('note-stale-2', 'token');

    expect(submitWithFallback).toHaveBeenCalledWith(
      expect.objectContaining({
        itemId: 'note-stale-2',
        payload: expect.objectContaining({ requestId: 'note-stale-2', remoteId: 'server-9' }),
      }),
    );
  });

  it('5. POST retry: syncing復旧の再送でもrequestId（note.id）は不変', async () => {
    const staleSyncing = makeNote({ id: 'note-stale-3', sync_status: 'syncing', d1_note_id: null });
    getNote.mockResolvedValueOnce(staleSyncing).mockResolvedValueOnce(staleSyncing);
    submitWithFallback.mockResolvedValue({ ok: true });

    const { syncWineTastingNote } = await import('../src/submission/wineTastingNoteSync');
    await syncWineTastingNote('note-stale-3', 'token');

    const call = submitWithFallback.mock.calls[0][0];
    expect(call.payload.requestId).toBe('note-stale-3');
    expect(call.itemId).toBe('note-stale-3');
  });

  it('7/8. syncing復旧の再送: 成功ならsynced、失敗ならfailedへ遷移する', async () => {
    const a = makeNote({ id: 'note-a', sync_status: 'syncing' });
    getNote.mockResolvedValueOnce(a).mockResolvedValueOnce(a);
    submitWithFallback.mockResolvedValueOnce({ ok: true });
    const { syncWineTastingNote } = await import('../src/submission/wineTastingNoteSync');
    await syncWineTastingNote('note-a', 'token');
    expect(saveNote).toHaveBeenLastCalledWith(expect.objectContaining({ sync_status: 'synced' }));

    saveNote.mockClear();
    const b = makeNote({ id: 'note-b', sync_status: 'syncing' });
    getNote.mockResolvedValueOnce(b).mockResolvedValueOnce(b);
    submitWithFallback.mockResolvedValueOnce({ ok: false, item: { ...b, state: 'pending' } });
    await syncWineTastingNote('note-b', 'token');
    expect(saveNote).toHaveBeenLastCalledWith(expect.objectContaining({ sync_status: 'failed' }));
  });

  it('9. syncing復旧の再送が失敗しても、IndexedDBからNoteを削除しない', async () => {
    const stale = makeNote({ id: 'note-stale-4', sync_status: 'syncing' });
    getNote.mockResolvedValueOnce(stale).mockResolvedValueOnce(stale);
    submitWithFallback.mockResolvedValue({ ok: false, item: { ...stale, state: 'pending' } });

    const { syncWineTastingNote } = await import('../src/submission/wineTastingNoteSync');
    await syncWineTastingNote('note-stale-4', 'token');

    // このモジュールはdeleteNoteを一切importしていない＝削除しようがないことが構成自体で保証される
    expect(saveNote).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'note-stale-4', sync_status: 'failed' }));
  });
});

describe('retryPendingWineTastingNotes', () => {
  beforeEach(() => {
    submitWithFallback.mockReset();
    getAllNotes.mockReset();
    getNote.mockReset();
    saveNote.mockReset();
    saveNote.mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
  });

  it('2. online相当（オプション省略=デフォルト）: local・failedのみを対象にし、synced/syncingは対象外', async () => {
    const local = makeNote({ id: 'n-local', sync_status: 'local' });
    const failed = makeNote({ id: 'n-failed', sync_status: 'failed' });
    const synced = makeNote({ id: 'n-synced', sync_status: 'synced' });
    const syncing = makeNote({ id: 'n-syncing', sync_status: 'syncing' });
    getAllNotes.mockResolvedValue([local, failed, synced, syncing]);
    getNote.mockImplementation((id: string) => {
      if (id === 'n-local') return Promise.resolve(local);
      if (id === 'n-failed') return Promise.resolve(failed);
      if (id === 'n-syncing') return Promise.resolve(syncing);
      return Promise.resolve(synced);
    });
    submitWithFallback.mockResolvedValue({ ok: true });

    const { retryPendingWineTastingNotes } = await import('../src/submission/wineTastingNoteSync');
    await retryPendingWineTastingNotes('token');

    expect(submitWithFallback).toHaveBeenCalledTimes(2);
    const itemIds = submitWithFallback.mock.calls.map((c) => c[0].itemId);
    expect(itemIds.sort()).toEqual(['n-failed', 'n-local']);
  });

  it('1. startup相当（includeSyncing:true）: local・failedに加えsyncingも再送対象に含める', async () => {
    const local = makeNote({ id: 'n-local', sync_status: 'local' });
    const failed = makeNote({ id: 'n-failed', sync_status: 'failed' });
    const synced = makeNote({ id: 'n-synced', sync_status: 'synced' });
    const syncing = makeNote({ id: 'n-syncing', sync_status: 'syncing' });
    getAllNotes.mockResolvedValue([local, failed, synced, syncing]);
    getNote.mockImplementation((id: string) => {
      if (id === 'n-local') return Promise.resolve(local);
      if (id === 'n-failed') return Promise.resolve(failed);
      if (id === 'n-syncing') return Promise.resolve(syncing);
      return Promise.resolve(synced);
    });
    submitWithFallback.mockResolvedValue({ ok: true });

    const { retryPendingWineTastingNotes } = await import('../src/submission/wineTastingNoteSync');
    await retryPendingWineTastingNotes('token', { includeSyncing: true });

    expect(submitWithFallback).toHaveBeenCalledTimes(3);
    const itemIds = submitWithFallback.mock.calls.map((c) => c[0].itemId);
    expect(itemIds.sort()).toEqual(['n-failed', 'n-local', 'n-syncing']);
    // synced（n-synced）はincludeSyncing:trueでも対象外のまま
    expect(itemIds).not.toContain('n-synced');
  });

  it('未ログイン/オフラインなら何もしない', async () => {
    getAllNotes.mockResolvedValue([makeNote({ sync_status: 'local' })]);

    const { retryPendingWineTastingNotes } = await import('../src/submission/wineTastingNoteSync');
    await retryPendingWineTastingNotes(null);

    expect(getAllNotes).not.toHaveBeenCalled();
    expect(submitWithFallback).not.toHaveBeenCalled();
  });
});
