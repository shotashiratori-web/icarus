import { describe, expect, it, vi, beforeEach } from 'vitest';
import { newWineNote } from '../src/types/wine';
import type { WineNote } from '../src/types/wine';

// Tasting Note Persistence v1（Stage 1D-B）。wineTastingNotePhotoAdapterのsubmit()を検証する。
// - photo_asset_idの有無でupload/finalizeをskipできるか（retry時の再upload防止）
// - finalize成功時点でlink成功を待たずにphoto_asset_idを保存するか
// - upload/link/unlinkそれぞれの失敗が正しいphoto_sync_error_codeへ分類されるか
// - 同一Noteの写真retryで同じrequestId（UUID v4）を使い回すか
// 実際のfetch/IndexedDBには触れず、api/photoAssetApi・api/wineTastingNoteApi・db/localDBをmockする。

const { createUploadAndFinalizeAsset } = vi.hoisted(() => ({ createUploadAndFinalizeAsset: vi.fn() }));
const { linkWineTastingNotePhoto, unlinkWineTastingNotePhoto } = vi.hoisted(() => ({
  linkWineTastingNotePhoto: vi.fn(),
  unlinkWineTastingNotePhoto: vi.fn(),
}));
const { getNote, saveNote } = vi.hoisted(() => ({ getNote: vi.fn(), saveNote: vi.fn() }));

vi.mock('../src/api/photoAssetApi', () => ({ createUploadAndFinalizeAsset }));
vi.mock('../src/api/wineTastingNoteApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/api/wineTastingNoteApi')>();
  return { ...actual, linkWineTastingNotePhoto, unlinkWineTastingNotePhoto };
});
vi.mock('../src/db/localDB', () => ({ getNote, saveNote }));

async function getAdapter() {
  await import('../src/submission/adapters/wineTastingNotePhotoAdapter');
  const { getAdapter } = await import('../src/submission/registry');
  return getAdapter('wineTastingNotePhoto');
}

function makeNote(overrides: Partial<WineNote> = {}): WineNote {
  return {
    ...newWineNote(),
    id: 'note-1',
    d1_note_id: 'd1-note-1',
    photo_operation: 'sync',
    photo_sync_status: 'uploading',
    photo_original_base64: 'BASE64ORIGINAL',
    photo_original_filename: 'photo.jpg',
    photo_original_mime_type: 'image/jpeg',
    photo_file_hash: 'a'.repeat(64),
    ...overrides,
  };
}

describe('wineTastingNotePhotoAdapter.submit — sync（upload/finalize/link）', () => {
  beforeEach(() => {
    createUploadAndFinalizeAsset.mockReset();
    linkWineTastingNotePhoto.mockReset();
    unlinkWineTastingNotePhoto.mockReset();
    getNote.mockReset();
    saveNote.mockReset();
    saveNote.mockResolvedValue(undefined);
  });

  it('6. d1_note_idが無ければuploadしない（本文sync完了待ち）', async () => {
    const note = makeNote({ d1_note_id: null });
    getNote.mockResolvedValue(note);
    const adapter = await getAdapter();

    await adapter.submit({ noteId: 'note-1' }, 'token');

    expect(createUploadAndFinalizeAsset).not.toHaveBeenCalled();
    expect(linkWineTastingNotePhoto).not.toHaveBeenCalled();
  });

  it('7. photo_asset_idが無ければcreateUploadAndFinalizeAssetを呼ぶ', async () => {
    const note = makeNote({ photo_asset_id: null });
    getNote.mockResolvedValue(note);
    createUploadAndFinalizeAsset.mockResolvedValue('asset-new-1');
    linkWineTastingNotePhoto.mockResolvedValue({ duplicate: false });
    const adapter = await getAdapter();

    await adapter.submit({ noteId: 'note-1' }, 'token');

    expect(createUploadAndFinalizeAsset).toHaveBeenCalledWith(
      expect.objectContaining({
        fileHash: 'a'.repeat(64),
        originalFilename: 'photo.jpg',
        mimeType: 'image/jpeg',
      }),
      'BASE64ORIGINAL',
      'token',
    );
  });

  it('8/9. finalize成功時点でlink結果を待たずphoto_asset_idを保存する（link失敗でも保持）', async () => {
    const note = makeNote({ photo_asset_id: null });
    getNote.mockResolvedValue(note);
    createUploadAndFinalizeAsset.mockResolvedValue('asset-new-2');
    linkWineTastingNotePhoto.mockRejectedValue(new Error('link network error'));
    const adapter = await getAdapter();

    await expect(adapter.submit({ noteId: 'note-1' }, 'token')).rejects.toThrow();

    const assetIdSaveCall = saveNote.mock.calls.find((c) => c[0].photo_asset_id === 'asset-new-2');
    expect(assetIdSaveCall).toBeTruthy();
    // 最終呼び出し（失敗マーキング）でもphoto_asset_idが消えていないこと
    const lastCall = saveNote.mock.calls[saveNote.mock.calls.length - 1][0];
    expect(lastCall.photo_sync_status).toBe('failed');
    expect(lastCall.photo_sync_error_code).toBe('LINK_FAILED');
  });

  it('10/11. photo_asset_idが既にあればupload/finalizeをskipしlinkのみ呼ぶ（retry時の再uploadなし）', async () => {
    const note = makeNote({ photo_asset_id: 'asset-existing' });
    getNote.mockResolvedValue(note);
    linkWineTastingNotePhoto.mockResolvedValue({ duplicate: false });
    const adapter = await getAdapter();

    await adapter.submit({ noteId: 'note-1' }, 'token');

    expect(createUploadAndFinalizeAsset).not.toHaveBeenCalled();
    expect(linkWineTastingNotePhoto).toHaveBeenCalledWith('d1-note-1', 'asset-existing', 'token');
  });

  it('12. link成功でphoto_sync_status=synced', async () => {
    const note = makeNote({ photo_asset_id: 'asset-existing' });
    getNote.mockResolvedValue(note);
    linkWineTastingNotePhoto.mockResolvedValue({ duplicate: false });
    const adapter = await getAdapter();

    await adapter.submit({ noteId: 'note-1' }, 'token');

    const lastCall = saveNote.mock.calls[saveNote.mock.calls.length - 1][0];
    expect(lastCall.photo_sync_status).toBe('synced');
    expect(lastCall.photo_sync_error_code).toBeNull();
    expect(lastCall.photo_operation).toBe('none');
  });

  it('27. link成功時にphoto_original_base64をclearする（identity/filename/mimeType/hashは保持）', async () => {
    const note = makeNote({ photo_asset_id: 'asset-existing', photo_request_id: 'req-existing' });
    getNote.mockResolvedValue(note);
    linkWineTastingNotePhoto.mockResolvedValue({ duplicate: false });
    const adapter = await getAdapter();

    await adapter.submit({ noteId: 'note-1' }, 'token');

    const lastCall = saveNote.mock.calls[saveNote.mock.calls.length - 1][0];
    expect(lastCall.photo_original_base64).toBeNull();
    // local preview/identity/debug用のfieldはStage 23の方針どおり保持する
    expect(lastCall.photo_asset_id).toBe('asset-existing');
    expect(lastCall.photo_request_id).toBe('req-existing');
    expect(lastCall.photo_original_filename).toBe('photo.jpg');
    expect(lastCall.photo_original_mime_type).toBe('image/jpeg');
    expect(lastCall.photo_file_hash).toBe('a'.repeat(64));
  });

  it('13. upload失敗（コード無し）はUPLOAD_FAILEDへ分類する', async () => {
    const note = makeNote({ photo_asset_id: null });
    getNote.mockResolvedValue(note);
    createUploadAndFinalizeAsset.mockRejectedValue(new Error('network error'));
    const adapter = await getAdapter();

    await expect(adapter.submit({ noteId: 'note-1' }, 'token')).rejects.toThrow();

    const lastCall = saveNote.mock.calls[saveNote.mock.calls.length - 1][0];
    expect(lastCall.photo_sync_status).toBe('failed');
    expect(lastCall.photo_sync_error_code).toBe('UPLOAD_FAILED');
  });

  it('15. ASSET_UNSUPPORTED_MIME_TYPEはUNSUPPORTED_MEDIA_TYPEへ分類する', async () => {
    const { PhotoUploadFailedError } = await import('../src/api/fieldLogD1Api');
    const note = makeNote({ photo_asset_id: null });
    getNote.mockResolvedValue(note);
    createUploadAndFinalizeAsset.mockRejectedValue(new PhotoUploadFailedError('mimeType must be one of: image/jpeg', 'ASSET_UNSUPPORTED_MIME_TYPE'));
    const adapter = await getAdapter();

    await expect(adapter.submit({ noteId: 'note-1' }, 'token')).rejects.toThrow();

    const lastCall = saveNote.mock.calls[saveNote.mock.calls.length - 1][0];
    expect(lastCall.photo_sync_error_code).toBe('UNSUPPORTED_MEDIA_TYPE');
  });

  it('ASSET_FINALIZE_*はFINALIZE_FAILEDへ分類する', async () => {
    const { PhotoUploadFailedError } = await import('../src/api/fieldLogD1Api');
    const note = makeNote({ photo_asset_id: null });
    getNote.mockResolvedValue(note);
    createUploadAndFinalizeAsset.mockRejectedValue(new PhotoUploadFailedError('R2へのアップロードがまだ確認できません', 'ASSET_FINALIZE_R2_OBJECT_MISSING'));
    const adapter = await getAdapter();

    await expect(adapter.submit({ noteId: 'note-1' }, 'token')).rejects.toThrow();

    const lastCall = saveNote.mock.calls[saveNote.mock.calls.length - 1][0];
    expect(lastCall.photo_sync_error_code).toBe('FINALIZE_FAILED');
  });

  it('14. link失敗はLINK_FAILEDへ分類する', async () => {
    const note = makeNote({ photo_asset_id: 'asset-existing' });
    getNote.mockResolvedValue(note);
    linkWineTastingNotePhoto.mockRejectedValue(new Error('server error'));
    const adapter = await getAdapter();

    await expect(adapter.submit({ noteId: 'note-1' }, 'token')).rejects.toThrow();

    const lastCall = saveNote.mock.calls[saveNote.mock.calls.length - 1][0];
    expect(lastCall.photo_sync_status).toBe('failed');
    expect(lastCall.photo_sync_error_code).toBe('LINK_FAILED');
  });

  it('28. 既にphoto_request_idがあれば同じrequestIdを使い回す（毎回random UUIDにしない）', async () => {
    const note = makeNote({ photo_asset_id: null, photo_request_id: 'stable-request-id-1' });
    getNote.mockResolvedValue(note);
    createUploadAndFinalizeAsset.mockResolvedValue('asset-new-3');
    linkWineTastingNotePhoto.mockResolvedValue({ duplicate: false });
    const adapter = await getAdapter();

    await adapter.submit({ noteId: 'note-1' }, 'token');

    expect(createUploadAndFinalizeAsset).toHaveBeenCalledWith(
      expect.objectContaining({ requestId: 'stable-request-id-1' }),
      expect.anything(),
      'token',
    );
    // requestId生成のための追加saveNoteは発生しない
    expect(saveNote.mock.calls.some((c) => c[0].photo_request_id && c[0].photo_request_id !== 'stable-request-id-1')).toBe(false);
  });

  it('photo_request_idが未設定なら新規UUIDを生成し保存する', async () => {
    const note = makeNote({ photo_asset_id: null, photo_request_id: null });
    getNote.mockResolvedValue(note);
    createUploadAndFinalizeAsset.mockResolvedValue('asset-new-4');
    linkWineTastingNotePhoto.mockResolvedValue({ duplicate: false });
    const adapter = await getAdapter();

    await adapter.submit({ noteId: 'note-1' }, 'token');

    const requestIdSaveCall = saveNote.mock.calls.find((c) => typeof c[0].photo_request_id === 'string' && c[0].photo_request_id !== null);
    expect(requestIdSaveCall).toBeTruthy();
    expect(createUploadAndFinalizeAsset).toHaveBeenCalledWith(
      expect.objectContaining({ requestId: requestIdSaveCall![0].photo_request_id }),
      expect.anything(),
      'token',
    );
  });
});

describe('wineTastingNotePhotoAdapter.submit — remove（unlink）', () => {
  beforeEach(() => {
    createUploadAndFinalizeAsset.mockReset();
    linkWineTastingNotePhoto.mockReset();
    unlinkWineTastingNotePhoto.mockReset();
    getNote.mockReset();
    saveNote.mockReset();
    saveNote.mockResolvedValue(undefined);
  });

  it('16. photo_operation=removeならunlinkWineTastingNotePhotoを呼ぶ', async () => {
    const note = makeNote({ photo_operation: 'remove', photo_asset_id: 'asset-existing' });
    getNote.mockResolvedValue(note);
    unlinkWineTastingNotePhoto.mockResolvedValue({ removed: true });
    const adapter = await getAdapter();

    await adapter.submit({ noteId: 'note-1' }, 'token');

    expect(unlinkWineTastingNotePhoto).toHaveBeenCalledWith('d1-note-1', 'token');
  });

  it('17. unlink成功後はidentityを完全にクリアする', async () => {
    const note = makeNote({ photo_operation: 'remove', photo_asset_id: 'asset-existing', photo_request_id: 'req-1' });
    getNote.mockResolvedValue(note);
    unlinkWineTastingNotePhoto.mockResolvedValue({ removed: true });
    const adapter = await getAdapter();

    await adapter.submit({ noteId: 'note-1' }, 'token');

    const lastCall = saveNote.mock.calls[saveNote.mock.calls.length - 1][0];
    expect(lastCall.photo_sync_status).toBe('none');
    expect(lastCall.photo_sync_error_code).toBeNull();
    expect(lastCall.photo_operation).toBe('none');
    expect(lastCall.photo_asset_id).toBeNull();
    expect(lastCall.photo_original_base64).toBeNull();
    expect(lastCall.photo_original_filename).toBe('');
    expect(lastCall.photo_original_mime_type).toBe('');
    expect(lastCall.photo_file_hash).toBeNull();
    expect(lastCall.photo_request_id).toBeNull();
  });

  it('18. unlink失敗時はidentity（photo_asset_id等）を保持し、UNLINK_FAILEDへ分類する', async () => {
    const note = makeNote({ photo_operation: 'remove', photo_asset_id: 'asset-existing' });
    getNote.mockResolvedValue(note);
    unlinkWineTastingNotePhoto.mockRejectedValue(new Error('network error'));
    const adapter = await getAdapter();

    await expect(adapter.submit({ noteId: 'note-1' }, 'token')).rejects.toThrow();

    const lastCall = saveNote.mock.calls[saveNote.mock.calls.length - 1][0];
    expect(lastCall.photo_sync_status).toBe('failed');
    expect(lastCall.photo_sync_error_code).toBe('UNLINK_FAILED');
    expect(lastCall.photo_asset_id).toBe('asset-existing');
  });

  it('removeでd1_note_idが無ければserver呼び出し無しでローカルidentityのみ整理する', async () => {
    const note = makeNote({ photo_operation: 'remove', d1_note_id: null, photo_asset_id: null, photo_original_base64: 'X' });
    getNote.mockResolvedValue(note);
    const adapter = await getAdapter();

    await adapter.submit({ noteId: 'note-1' }, 'token');

    expect(unlinkWineTastingNotePhoto).not.toHaveBeenCalled();
    const lastCall = saveNote.mock.calls[saveNote.mock.calls.length - 1][0];
    expect(lastCall.photo_operation).toBe('none');
    expect(lastCall.photo_original_base64).toBeNull();
  });
});
