import { describe, expect, it, vi, beforeEach } from 'vitest';
import { newWineNote } from '../src/types/wine';
import type { WineNote } from '../src/types/wine';

// Tasting Note Persistence v1（Stage 1D-B）。syncWineTastingNotePhoto/retryPendingWineTastingNotePhotosの
// 対象範囲（d1_note_id gate・UNSUPPORTED_MEDIA_TYPE除外・startup/online差分・inFlight排他）を検証する。

const { submitWithFallback } = vi.hoisted(() => ({ submitWithFallback: vi.fn() }));
const { getAllNotes, getNote, saveNote } = vi.hoisted(() => ({
  getAllNotes: vi.fn(),
  getNote: vi.fn(),
  saveNote: vi.fn(),
}));

vi.mock('../src/submission/orchestrator', () => ({ submitWithFallback }));
vi.mock('../src/db/localDB', () => ({ getAllNotes, getNote, saveNote }));

function makeNote(overrides: Partial<WineNote> = {}): WineNote {
  return {
    ...newWineNote(),
    id: 'note-1',
    d1_note_id: 'd1-note-1',
    ...overrides,
  };
}

describe('syncWineTastingNotePhoto', () => {
  beforeEach(() => {
    submitWithFallback.mockReset();
    getAllNotes.mockReset();
    getNote.mockReset();
    saveNote.mockReset();
    saveNote.mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
  });

  it('未ログインなら何もしない', async () => {
    const { syncWineTastingNotePhoto } = await import('../src/submission/wineTastingNotePhotoSync');
    await syncWineTastingNotePhoto('note-1', null);
    expect(getNote).not.toHaveBeenCalled();
    expect(submitWithFallback).not.toHaveBeenCalled();
  });

  it('オフラインなら何もしない', async () => {
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
    const { syncWineTastingNotePhoto } = await import('../src/submission/wineTastingNotePhotoSync');
    await syncWineTastingNotePhoto('note-1', 'token');
    expect(submitWithFallback).not.toHaveBeenCalled();
    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
  });

  it('24. d1_note_idが無ければskipする（本文sync未完了）', async () => {
    const note = makeNote({ d1_note_id: null, photo_operation: 'sync' });
    getNote.mockResolvedValue(note);
    const { syncWineTastingNotePhoto } = await import('../src/submission/wineTastingNotePhotoSync');
    await syncWineTastingNotePhoto('note-1', 'token');
    expect(submitWithFallback).not.toHaveBeenCalled();
  });

  it('photo_operation=noneならskipする', async () => {
    const note = makeNote({ photo_operation: 'none' });
    getNote.mockResolvedValue(note);
    const { syncWineTastingNotePhoto } = await import('../src/submission/wineTastingNotePhotoSync');
    await syncWineTastingNotePhoto('note-1', 'token');
    expect(submitWithFallback).not.toHaveBeenCalled();
  });

  it('4. queue payloadはnoteIdのみの軽量オブジェクト（Original Base64を含まない）', async () => {
    const note = makeNote({ photo_operation: 'sync', photo_original_base64: 'HUGE_BASE64_DATA' });
    getNote.mockResolvedValue(note);
    submitWithFallback.mockResolvedValue({ ok: true });
    const { syncWineTastingNotePhoto } = await import('../src/submission/wineTastingNotePhotoSync');
    await syncWineTastingNotePhoto('note-1', 'token');

    expect(submitWithFallback).toHaveBeenCalledWith(
      expect.objectContaining({ entity: 'wineTastingNotePhoto', payload: { noteId: 'note-1' } }),
    );
    const call = submitWithFallback.mock.calls[0][0];
    expect(JSON.stringify(call.payload)).not.toContain('HUGE_BASE64_DATA');
  });

  it('itemIdは本文（wineTastingNote, itemId=note.id）と衝突しないようサフィックスを付ける', async () => {
    const note = makeNote({ photo_operation: 'sync' });
    getNote.mockResolvedValue(note);
    submitWithFallback.mockResolvedValue({ ok: true });
    const { syncWineTastingNotePhoto } = await import('../src/submission/wineTastingNotePhotoSync');
    await syncWineTastingNotePhoto('note-1', 'token');

    const call = submitWithFallback.mock.calls[0][0];
    expect(call.itemId).not.toBe('note-1');
    expect(call.itemId).toContain('note-1');
  });

  it('15. photo_sync_error_code=UNSUPPORTED_MEDIA_TYPEは自動retry対象外', async () => {
    const note = makeNote({ photo_operation: 'sync', photo_sync_status: 'failed', photo_sync_error_code: 'UNSUPPORTED_MEDIA_TYPE' });
    getNote.mockResolvedValue(note);
    const { syncWineTastingNotePhoto } = await import('../src/submission/wineTastingNotePhotoSync');
    await syncWineTastingNotePhoto('note-1', 'token');
    expect(submitWithFallback).not.toHaveBeenCalled();
  });

  it('25. 同一noteIdの同時呼び出しはinFlightで二重送信を防止する', async () => {
    const note = makeNote({ photo_operation: 'sync' });
    getNote.mockResolvedValue(note);
    let resolveSubmit!: (v: { ok: true }) => void;
    submitWithFallback.mockReturnValue(new Promise((resolve) => { resolveSubmit = resolve; }));
    const { syncWineTastingNotePhoto } = await import('../src/submission/wineTastingNotePhotoSync');

    const first = syncWineTastingNotePhoto('note-1', 'token');
    const second = syncWineTastingNotePhoto('note-1', 'token'); // 1回目が完了する前に呼ぶ
    resolveSubmit({ ok: true });
    await Promise.all([first, second]);

    expect(submitWithFallback).toHaveBeenCalledTimes(1);
  });
});

describe('retryPendingWineTastingNotePhotos', () => {
  beforeEach(() => {
    submitWithFallback.mockReset();
    getAllNotes.mockReset();
    getNote.mockReset();
    saveNote.mockReset();
    saveNote.mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
  });

  it('19/20. online相当（デフォルト）: local・failedを対象にする', async () => {
    const local = makeNote({ id: 'n-local', photo_operation: 'sync', photo_sync_status: 'local' });
    const failed = makeNote({ id: 'n-failed', photo_operation: 'sync', photo_sync_status: 'failed' });
    getAllNotes.mockResolvedValue([local, failed]);
    getNote.mockImplementation((id: string) => Promise.resolve(id === 'n-local' ? local : failed));
    submitWithFallback.mockResolvedValue({ ok: true });

    const { retryPendingWineTastingNotePhotos } = await import('../src/submission/wineTastingNotePhotoSync');
    await retryPendingWineTastingNotePhotos('token');

    expect(submitWithFallback).toHaveBeenCalledTimes(2);
  });

  it('21. startup相当（includeUploading:true）: uploadingも対象に含める', async () => {
    const uploading = makeNote({ id: 'n-uploading', photo_operation: 'sync', photo_sync_status: 'uploading' });
    getAllNotes.mockResolvedValue([uploading]);
    getNote.mockResolvedValue(uploading);
    submitWithFallback.mockResolvedValue({ ok: true });

    const { retryPendingWineTastingNotePhotos } = await import('../src/submission/wineTastingNotePhotoSync');
    await retryPendingWineTastingNotePhotos('token', { includeUploading: true });

    expect(submitWithFallback).toHaveBeenCalledTimes(1);
  });

  it('22. online相当（デフォルト）: uploadingは対象外', async () => {
    const uploading = makeNote({ id: 'n-uploading', photo_operation: 'sync', photo_sync_status: 'uploading' });
    getAllNotes.mockResolvedValue([uploading]);
    getNote.mockResolvedValue(uploading);

    const { retryPendingWineTastingNotePhotos } = await import('../src/submission/wineTastingNotePhotoSync');
    await retryPendingWineTastingNotePhotos('token');

    expect(submitWithFallback).not.toHaveBeenCalled();
  });

  it('24. d1_note_idが無いNoteは対象外', async () => {
    const noD1 = makeNote({ id: 'n-no-d1', d1_note_id: null, photo_operation: 'sync', photo_sync_status: 'local' });
    getAllNotes.mockResolvedValue([noD1]);

    const { retryPendingWineTastingNotePhotos } = await import('../src/submission/wineTastingNotePhotoSync');
    await retryPendingWineTastingNotePhotos('token', { includeUploading: true });

    expect(submitWithFallback).not.toHaveBeenCalled();
  });

  it('15. UNSUPPORTED_MEDIA_TYPEは対象外（startup/online双方）', async () => {
    const unsupported = makeNote({
      id: 'n-unsupported', photo_operation: 'sync', photo_sync_status: 'failed', photo_sync_error_code: 'UNSUPPORTED_MEDIA_TYPE',
    });
    getAllNotes.mockResolvedValue([unsupported]);

    const { retryPendingWineTastingNotePhotos } = await import('../src/submission/wineTastingNotePhotoSync');
    await retryPendingWineTastingNotePhotos('token', { includeUploading: true });

    expect(submitWithFallback).not.toHaveBeenCalled();
  });

  it('photo_operation=noneのNoteは対象外', async () => {
    const none = makeNote({ id: 'n-none', photo_operation: 'none' });
    getAllNotes.mockResolvedValue([none]);

    const { retryPendingWineTastingNotePhotos } = await import('../src/submission/wineTastingNotePhotoSync');
    await retryPendingWineTastingNotePhotos('token', { includeUploading: true });

    expect(submitWithFallback).not.toHaveBeenCalled();
  });

  it('未ログイン/オフラインなら何もしない', async () => {
    getAllNotes.mockResolvedValue([makeNote({ photo_operation: 'sync', photo_sync_status: 'local' })]);
    const { retryPendingWineTastingNotePhotos } = await import('../src/submission/wineTastingNotePhotoSync');
    await retryPendingWineTastingNotePhotos(null);
    expect(getAllNotes).not.toHaveBeenCalled();
    expect(submitWithFallback).not.toHaveBeenCalled();
  });
});

describe('27. Pending List label', () => {
  it('ENTITY_LABELSにwineTastingNotePhotoが定義されている', async () => {
    const { ENTITY_LABELS } = await import('../src/submission/types');
    expect(ENTITY_LABELS.wineTastingNotePhoto).toBe('テイスティングノート写真');
  });
});
