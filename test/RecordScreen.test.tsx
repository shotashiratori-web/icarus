import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import RecordScreen from '../src/screens/RecordScreen';
import { useNoteStore } from '../src/store/noteStore';
import { newWineNote } from '../src/types/wine';
import { mockUseAuth } from './testAuth';
import type { AuthContextValue } from '../src/context/AuthContext';

// Tasting Note Persistence v1（Stage 1D-C）。RecordScreenの写真選択UXを検証する。
// - JPEG選択でpreview/Original/hash/metadataがnoteStoreへ反映されること
// - HEIC等JPEG以外の選択でUNSUPPORTED_MEDIA_TYPE状態のUIが出ること
// - 写真の同期状態（uploading/failed/retry）が本文と独立して表示されること
// - 保存が写真アップロード完了を待たないこと（即座に完了できること）
// 実際のfetch/IndexedDB/画像処理には触れず、icarusApi・localDB・sync層をmockする。

const { resizeToJpeg, readFileAsBase64, sha256Hex, isHeicFile } = vi.hoisted(() => ({
  resizeToJpeg: vi.fn(),
  readFileAsBase64: vi.fn(),
  sha256Hex: vi.fn(),
  isHeicFile: vi.fn(),
}));
vi.mock('../src/api/icarusApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/api/icarusApi')>();
  return { ...actual, resizeToJpeg, readFileAsBase64, sha256Hex, isHeicFile };
});

const { getNote, saveNote } = vi.hoisted(() => ({ getNote: vi.fn(), saveNote: vi.fn() }));
vi.mock('../src/db/localDB', () => ({ getNote, saveNote }));

const { syncWineTastingNote } = vi.hoisted(() => ({ syncWineTastingNote: vi.fn() }));
vi.mock('../src/submission/wineTastingNoteSync', () => ({ syncWineTastingNote }));

const { syncWineTastingNotePhoto } = vi.hoisted(() => ({ syncWineTastingNotePhoto: vi.fn() }));
vi.mock('../src/submission/wineTastingNotePhotoSync', () => ({ syncWineTastingNotePhoto }));

const { fetchWine } = vi.hoisted(() => ({ fetchWine: vi.fn() }));
vi.mock('../src/api/wineEntityApi', () => ({ fetchWine }));

let authOverride: AuthContextValue = mockUseAuth();
vi.mock('../src/context/AuthContext', () => ({ useAuth: () => authOverride }));

function makeJpegFile(name = 'photo.jpg'): File {
  return new File(['jpeg-bytes'], name, { type: 'image/jpeg' });
}
function makeHeicFile(name = 'photo.heic'): File {
  return new File(['heic-bytes'], name, { type: 'image/heic' });
}

async function selectFile(file: File) {
  const input = document.querySelector('input[type="file"]') as HTMLInputElement;
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  fireEvent.change(input);
}

describe('RecordScreen — 写真選択（Stage 1D-C）', () => {
  beforeEach(() => {
    resizeToJpeg.mockReset();
    readFileAsBase64.mockReset();
    sha256Hex.mockReset();
    isHeicFile.mockReset();
    isHeicFile.mockReturnValue(false);
    getNote.mockReset();
    saveNote.mockReset();
    saveNote.mockResolvedValue(undefined);
    syncWineTastingNote.mockReset();
    syncWineTastingNotePhoto.mockReset();
    fetchWine.mockReset();
    authOverride = mockUseAuth();
    useNoteStore.getState().clear();
  });

  it('1/2/3/4/5. JPEG選択でpreview・Original Base64・hash・filename・mimeTypeがnoteへ反映される', async () => {
    resizeToJpeg.mockResolvedValue('PREVIEWBASE64');
    readFileAsBase64.mockResolvedValue('ORIGINALBASE64');
    sha256Hex.mockResolvedValue('a'.repeat(64));

    render(<RecordScreen noteId={null} go={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('📷 写真を追加')).toBeInTheDocument());

    await selectFile(makeJpegFile());

    await waitFor(() => expect(useNoteStore.getState().note?.label_photo_url).toBe('data:image/jpeg;base64,PREVIEWBASE64'));
    const note = useNoteStore.getState().note!;
    expect(note.photo_original_base64).toBe('ORIGINALBASE64');
    expect(note.photo_original_filename).toBe('photo.jpg');
    expect(note.photo_original_mime_type).toBe('image/jpeg');
    expect(note.photo_file_hash).toBe('a'.repeat(64));
    expect(note.photo_operation).toBe('sync');
    expect(note.photo_sync_status).toBe('local');
    // previewが実際に<img>として描画される（alt=""のためrole=imgではなくpresentationになる → querySelectorで確認）
    const img = document.querySelector('img');
    expect(img).toHaveAttribute('src', 'data:image/jpeg;base64,PREVIEWBASE64');
  });

  it('12/13. HEIC選択はpreviewのみ表示し、UNSUPPORTED_MEDIA_TYPEのヒントを出す（再試行ボタンなし）', async () => {
    resizeToJpeg.mockResolvedValue('HEICPREVIEW');
    isHeicFile.mockReturnValue(true);

    render(<RecordScreen noteId={null} go={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('📷 写真を追加')).toBeInTheDocument());

    await selectFile(makeHeicFile());

    await waitFor(() => expect(screen.getByText(/この写真形式はまだ同期できません/)).toBeInTheDocument());
    expect(useNoteStore.getState().note?.photo_sync_error_code).toBe('UNSUPPORTED_MEDIA_TYPE');
    expect(readFileAsBase64).not.toHaveBeenCalled();
    expect(sha256Hex).not.toHaveBeenCalled();
    expect(screen.queryByText('再試行')).not.toBeInTheDocument();
  });

  it('20/22. retryable失敗はメッセージ+再試行ボタンを表示し、押すとsyncWineTastingNotePhotoを呼ぶ', async () => {
    getNote.mockResolvedValue({
      ...newWineNote(),
      id: 'note-failed',
      label_photo_url: 'data:image/jpeg;base64,X',
      photo_sync_status: 'failed',
      photo_sync_error_code: 'UPLOAD_FAILED',
    });
    render(<RecordScreen noteId="note-failed" go={vi.fn()} />);

    await waitFor(() => expect(screen.getByText('写真の同期に失敗しました')).toBeInTheDocument());
    const retryBtn = screen.getByText('再試行');
    fireEvent.click(retryBtn);

    expect(syncWineTastingNotePhoto).toHaveBeenCalledWith('note-failed', 'test-token');
  });

  it('21/23. uploading状態は「写真を同期中…」を表示し、再試行ボタンは出さない', async () => {
    getNote.mockResolvedValue({
      ...newWineNote(),
      id: 'note-uploading',
      label_photo_url: 'data:image/jpeg;base64,X',
      photo_sync_status: 'uploading',
    });
    render(<RecordScreen noteId="note-uploading" go={vi.fn()} />);

    await waitFor(() => expect(screen.getByText('写真を同期中…')).toBeInTheDocument());
    expect(screen.queryByText('再試行')).not.toBeInTheDocument();
  });

  it('18. 写真がuploading中でも保存ボタンは操作可能（アップロード完了を待たない）', async () => {
    const go = vi.fn();
    getNote.mockResolvedValue({
      ...newWineNote(),
      id: 'note-uploading-2',
      photo_sync_status: 'uploading',
    });
    render(<RecordScreen noteId="note-uploading-2" go={go} />);
    await waitFor(() => expect(screen.getByText('保存')).toBeInTheDocument());

    fireEvent.click(screen.getByText('保存'));

    await waitFor(() => expect(screen.getByText('✓ 保存')).toBeInTheDocument());
  });

  it('17. 保存時にsyncWineTastingNotePhotoを呼ぶ（d1_note_id gateは関数内部が持つ）', async () => {
    render(<RecordScreen noteId={null} go={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('保存')).toBeInTheDocument());

    fireEvent.click(screen.getByText('保存'));

    await waitFor(() => expect(syncWineTastingNotePhoto).toHaveBeenCalled());
    const note = useNoteStore.getState().note!;
    expect(syncWineTastingNotePhoto).toHaveBeenCalledWith(note.id, 'test-token');
  });

  it('15. 未ログイン（idToken=null）でも写真選択・保存が例外なく完了する', async () => {
    authOverride = { ...mockUseAuth(), idToken: null, authState: 'signedOut' };
    resizeToJpeg.mockResolvedValue('PREVIEWBASE64');
    readFileAsBase64.mockResolvedValue('ORIGINALBASE64');
    sha256Hex.mockResolvedValue('b'.repeat(64));

    render(<RecordScreen noteId={null} go={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('📷 写真を追加')).toBeInTheDocument());
    await selectFile(makeJpegFile());
    await waitFor(() => expect(useNoteStore.getState().note?.photo_original_base64).toBe('ORIGINALBASE64'));

    fireEvent.click(screen.getByText('保存'));
    await waitFor(() => expect(screen.getByText('✓ 保存')).toBeInTheDocument());
  });

  it('24. 写真削除ボタンで解除できる（server未linkのlocal-onlyケース）', async () => {
    resizeToJpeg.mockResolvedValue('PREVIEWBASE64');
    readFileAsBase64.mockResolvedValue('ORIGINALBASE64');
    sha256Hex.mockResolvedValue('c'.repeat(64));

    render(<RecordScreen noteId={null} go={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('📷 写真を追加')).toBeInTheDocument());
    await selectFile(makeJpegFile());
    await waitFor(() => expect(screen.getByText('写真を削除')).toBeInTheDocument());

    fireEvent.click(screen.getByText('写真を削除'));

    await waitFor(() => expect(useNoteStore.getState().note?.label_photo_url).toBeNull());
    const note = useNoteStore.getState().note!;
    expect(note.photo_operation).toBe('none');
    expect(note.photo_original_base64).toBeNull();
  });
});
