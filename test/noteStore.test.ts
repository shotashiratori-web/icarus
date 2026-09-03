import { describe, expect, it, vi, beforeEach } from 'vitest';
import { newWineNote } from '../src/types/wine';

// Tasting Note Persistence v1（Stage 1B）。persist()が、既にsync_status='synced'のNoteを
// 編集した場合にのみsync_statusを'local'へ戻し、次回の再送対象にすることを検証する
// （編集後もsync_status='synced'のまま残ると変更内容がサーバーへ反映されないバグを防ぐ）。

const { saveNote } = vi.hoisted(() => ({ saveNote: vi.fn() }));
vi.mock('../src/db/localDB', () => ({ saveNote }));

describe('noteStore.persist', () => {
  beforeEach(() => {
    saveNote.mockReset();
    saveNote.mockResolvedValue(undefined);
  });

  it('synced状態のNoteをdirtyな状態で保存すると、sync_statusをlocalへ戻して保存する', async () => {
    const { useNoteStore } = await import('../src/store/noteStore');
    const note = { ...newWineNote(), sync_status: 'synced' as const, d1_note_id: 'server-1' };
    useNoteStore.getState().setNote(note);
    useNoteStore.getState().updateField('memo', { text: '追記' }); // isDirty=trueにする

    await useNoteStore.getState().persist();

    expect(saveNote).toHaveBeenCalledWith(expect.objectContaining({ sync_status: 'local', d1_note_id: 'server-1' }));
    expect(useNoteStore.getState().note?.sync_status).toBe('local');
    expect(useNoteStore.getState().isDirty).toBe(false);
  });

  it('local状態のNoteを保存しても、sync_statusはlocalのまま変わらない', async () => {
    const { useNoteStore } = await import('../src/store/noteStore');
    const note = { ...newWineNote(), sync_status: 'local' as const };
    useNoteStore.getState().setNote(note);
    useNoteStore.getState().updateField('memo', { text: 'メモ' });

    await useNoteStore.getState().persist();

    expect(saveNote).toHaveBeenCalledWith(expect.objectContaining({ sync_status: 'local' }));
  });

  it('dirtyでない（isDirty=false）状態でpersistしても、synced状態を勝手にlocalへ戻さない', async () => {
    const { useNoteStore } = await import('../src/store/noteStore');
    const note = { ...newWineNote(), sync_status: 'synced' as const };
    useNoteStore.getState().setNote(note); // setNoteはisDirty=falseにする

    await useNoteStore.getState().persist();

    expect(saveNote).toHaveBeenCalledWith(expect.objectContaining({ sync_status: 'synced' }));
  });

  // Tasting Note Persistence v1（Stage 1C-A）
  it('5. synced状態のNoteでwine_idを変更（setWineId）すると、他フィールド編集と同様にlocalへ降格する', async () => {
    const { useNoteStore } = await import('../src/store/noteStore');
    const note = { ...newWineNote(), sync_status: 'synced' as const, d1_note_id: 'server-1', wine_id: null };
    useNoteStore.getState().setNote(note);
    useNoteStore.getState().setWineId('wine-uuid-1');

    await useNoteStore.getState().persist();

    expect(saveNote).toHaveBeenCalledWith(expect.objectContaining({ sync_status: 'local', wine_id: 'wine-uuid-1' }));
  });

  it('8. wine_idを設定しても、wine_name/producer/vintage等のsnapshot元フィールドは変更しない', async () => {
    const { useNoteStore } = await import('../src/store/noteStore');
    const note = newWineNote();
    note.fields.wine_name.text = '記録時点のワイン名';
    note.fields.producer.text = '記録時点の生産者';
    note.fields.vintage.text = '2020';
    useNoteStore.getState().setNote(note);

    useNoteStore.getState().setWineId('wine-uuid-2');

    const after = useNoteStore.getState().note!;
    expect(after.wine_id).toBe('wine-uuid-2');
    expect(after.fields.wine_name.text).toBe('記録時点のワイン名');
    expect(after.fields.producer.text).toBe('記録時点の生産者');
    expect(after.fields.vintage.text).toBe('2020');
  });

  it('7. setWineId(null)で紐付けを解除できる（Note自体・他フィールドは残る）', async () => {
    const { useNoteStore } = await import('../src/store/noteStore');
    const note = { ...newWineNote(), wine_id: 'wine-uuid-3', sync_status: 'synced' as const, d1_note_id: 'server-2' };
    useNoteStore.getState().setNote(note);

    useNoteStore.getState().setWineId(null);
    await useNoteStore.getState().persist();

    expect(saveNote).toHaveBeenCalledWith(expect.objectContaining({ wine_id: null, d1_note_id: 'server-2', sync_status: 'local' }));
  });

  it('setWineIdはnoteが無ければ何もしない', async () => {
    const { useNoteStore } = await import('../src/store/noteStore');
    useNoteStore.getState().clear();

    useNoteStore.getState().setWineId('wine-uuid-4');

    expect(useNoteStore.getState().note).toBeNull();
  });
});

// Tasting Note Persistence v1（Stage 1D-C）
describe('noteStore.setPhotoSelected / setPhotoUnsupported / removePhoto', () => {
  beforeEach(() => {
    saveNote.mockReset();
    saveNote.mockResolvedValue(undefined);
  });

  it('2/3/4/5/7. JPEG選択: preview・Original Base64・hash・filename・mimeType・photo_operation・statusを保存する', async () => {
    const { useNoteStore } = await import('../src/store/noteStore');
    useNoteStore.getState().setNote(newWineNote());

    useNoteStore.getState().setPhotoSelected({
      previewUrl: 'data:image/jpeg;base64,PREVIEW',
      originalBase64: 'ORIGINAL_BASE64',
      filename: 'photo.jpg',
      mimeType: 'image/jpeg',
      fileHash: 'a'.repeat(64),
    });

    const after = useNoteStore.getState().note!;
    expect(after.label_photo_url).toBe('data:image/jpeg;base64,PREVIEW');
    expect(after.photo_original_base64).toBe('ORIGINAL_BASE64');
    expect(after.photo_original_filename).toBe('photo.jpg');
    expect(after.photo_original_mime_type).toBe('image/jpeg');
    expect(after.photo_file_hash).toBe('a'.repeat(64));
    expect(after.photo_operation).toBe('sync');
    expect(after.photo_sync_status).toBe('local');
    expect(after.photo_sync_error_code).toBeNull();
    expect(useNoteStore.getState().isDirty).toBe(true);
  });

  it('6. photo_request_idを新規発行する', async () => {
    const { useNoteStore } = await import('../src/store/noteStore');
    useNoteStore.getState().setNote(newWineNote());

    useNoteStore.getState().setPhotoSelected({
      previewUrl: 'data:image/jpeg;base64,X', originalBase64: 'X', filename: 'a.jpg', mimeType: 'image/jpeg', fileHash: 'b'.repeat(64),
    });

    const requestId = useNoteStore.getState().note!.photo_request_id;
    expect(requestId).toMatch(/^[0-9a-f-]{36}$/i);
  });

  it('9/10. 既存写真から別写真への変更でphoto_asset_id/photo_request_idがリセットされる', async () => {
    const { useNoteStore } = await import('../src/store/noteStore');
    useNoteStore.getState().setNote({
      ...newWineNote(),
      photo_asset_id: 'old-asset-id',
      photo_request_id: 'old-request-id',
      photo_sync_status: 'synced',
    });

    useNoteStore.getState().setPhotoSelected({
      previewUrl: 'data:image/jpeg;base64,NEW', originalBase64: 'NEW_ORIGINAL', filename: 'new.jpg', mimeType: 'image/jpeg', fileHash: 'c'.repeat(64),
    });

    const after = useNoteStore.getState().note!;
    expect(after.photo_asset_id).toBeNull();
    expect(after.photo_request_id).not.toBe('old-request-id');
    expect(after.photo_request_id).toMatch(/^[0-9a-f-]{36}$/i);
  });

  it('11. 写真を変更してもwine_name/producer等のNote本文fieldは変更しない', async () => {
    const { useNoteStore } = await import('../src/store/noteStore');
    const note = newWineNote();
    note.fields.wine_name.text = '既存のワイン名';
    note.fields.memo.text = '既存のメモ';
    useNoteStore.getState().setNote(note);

    useNoteStore.getState().setPhotoSelected({
      previewUrl: 'data:image/jpeg;base64,X', originalBase64: 'X', filename: 'a.jpg', mimeType: 'image/jpeg', fileHash: 'd'.repeat(64),
    });

    const after = useNoteStore.getState().note!;
    expect(after.fields.wine_name.text).toBe('既存のワイン名');
    expect(after.fields.memo.text).toBe('既存のメモ');
  });

  // HEIC-B（HEIC Support v1）でHEIC/HEIFはsetPhotoSelected経由の対応formatへ移ったため、
  // このsetPhotoUnsupported経路の代表例はPNG等の非対応formatへ更新した（noteStore自体は
  // formatを判定しない・呼び出し元の値をそのまま保存するだけなので、挙動は変更していない）
  it('12/13. PNG等JPEG/HEIC/HEIF以外の選択はpreviewのみ設定しUNSUPPORTED_MEDIA_TYPEでfailedにする', async () => {
    const { useNoteStore } = await import('../src/store/noteStore');
    useNoteStore.getState().setNote(newWineNote());

    useNoteStore.getState().setPhotoUnsupported({
      previewUrl: 'data:image/jpeg;base64,PNGPREVIEW', filename: 'photo.png', mimeType: 'image/png',
    });

    const after = useNoteStore.getState().note!;
    expect(after.label_photo_url).toBe('data:image/jpeg;base64,PNGPREVIEW');
    expect(after.photo_operation).toBe('sync');
    expect(after.photo_sync_status).toBe('failed');
    expect(after.photo_sync_error_code).toBe('UNSUPPORTED_MEDIA_TYPE');
    expect(after.photo_original_base64).toBeNull();
    expect(after.photo_file_hash).toBeNull();
  });

  // Pre-PR監査（Stage 1D-C push前に発見）: photo_asset_idは新写真選択のたびリセットされる
  // candidate用のfieldであり、「serverに旧写真のlinkが残っているか」を表さない。
  // removePhoto()の分岐をphoto_server_linkedへ切り替えたことで、以下の差し替え中削除ケースで
  // 旧server linkが孤立（orphan）しなくなることを検証する。
  describe('Pre-PR監査: server-linked写真の差し替え中に削除しても旧linkが孤立しない', () => {
    it('1. server-linked → 新JPEG選択 → 削除 → unlink保留（operation=remove）', async () => {
      const { useNoteStore } = await import('../src/store/noteStore');
      useNoteStore.getState().setNote({
        ...newWineNote(),
        d1_note_id: 'd1-note-1',
        photo_asset_id: 'OLD_ASSET',
        photo_server_linked: true,
        photo_sync_status: 'synced',
        photo_operation: 'none',
      });

      useNoteStore.getState().setPhotoSelected({
        previewUrl: 'data:image/jpeg;base64,NEW', originalBase64: 'NEW_ORIGINAL',
        filename: 'new.jpg', mimeType: 'image/jpeg', fileHash: 'b'.repeat(64),
      });
      // 新写真選択直後、candidateのphoto_asset_idはリセットされるが、旧server linkの記憶は残る
      expect(useNoteStore.getState().note!.photo_asset_id).toBeNull();
      expect(useNoteStore.getState().note!.photo_server_linked).toBe(true);

      useNoteStore.getState().removePhoto();

      const after = useNoteStore.getState().note!;
      expect(after.photo_operation).toBe('remove');
      expect(after.photo_sync_status).toBe('local');
    });

    it('2. server-linked → 新JPEG upload失敗 → 削除 → unlink保留（operation=remove）', async () => {
      const { useNoteStore } = await import('../src/store/noteStore');
      // upload失敗直後の状態を再現：candidateはasset_id未確定のままfailedへ。旧server linkは無傷
      useNoteStore.getState().setNote({
        ...newWineNote(),
        d1_note_id: 'd1-note-1',
        photo_asset_id: null,
        photo_server_linked: true,
        photo_sync_status: 'failed',
        photo_sync_error_code: 'UPLOAD_FAILED',
        photo_operation: 'sync',
      });

      useNoteStore.getState().removePhoto();

      const after = useNoteStore.getState().note!;
      expect(after.photo_operation).toBe('remove');
    });

    // HEIC-B（HEIC Support v1）: HEICはsetPhotoSelected経由の対応formatになったため、
    // 「新HEIC選択」はJPEGと同じ経路（test 1）で検証する。photo_server_linkedの保持ロジックは
    // mimeTypeを見ないため、この形でも旧server linkの孤立防止（replacement safety）を確認できる
    it('3. server-linked → 新HEIC選択 → 削除 → unlink保留（operation=remove、HEIC replacement safety）', async () => {
      const { useNoteStore } = await import('../src/store/noteStore');
      useNoteStore.getState().setNote({
        ...newWineNote(),
        d1_note_id: 'd1-note-1',
        photo_asset_id: 'OLD_ASSET',
        photo_server_linked: true,
        photo_sync_status: 'synced',
        photo_operation: 'none',
      });

      useNoteStore.getState().setPhotoSelected({
        previewUrl: 'data:image/jpeg;base64,HEICPREVIEW', originalBase64: 'HEIC_ORIGINAL',
        filename: 'new.heic', mimeType: 'image/heic', fileHash: 'c'.repeat(64),
      });
      // 新写真選択直後、candidateのphoto_asset_idはリセットされるが、旧server linkの記憶は残る
      expect(useNoteStore.getState().note!.photo_asset_id).toBeNull();
      expect(useNoteStore.getState().note!.photo_server_linked).toBe(true);
      expect(useNoteStore.getState().note!.photo_original_mime_type).toBe('image/heic');

      useNoteStore.getState().removePhoto();

      const after = useNoteStore.getState().note!;
      expect(after.photo_operation).toBe('remove');
    });

    it('4. server-linked → 新Asset finalize成功/link失敗 → 削除 → unlink保留（operation=remove）', async () => {
      const { useNoteStore } = await import('../src/store/noteStore');
      // finalize成功でcandidateのasset_idは新しい値に確定するが、link失敗のためphoto_server_linkedは
      // まだ旧写真を指したまま（trueのまま、adapterが変更しない）
      useNoteStore.getState().setNote({
        ...newWineNote(),
        d1_note_id: 'd1-note-1',
        photo_asset_id: 'NEW_CANDIDATE_ASSET',
        photo_server_linked: true,
        photo_sync_status: 'failed',
        photo_sync_error_code: 'LINK_FAILED',
        photo_operation: 'sync',
      });

      useNoteStore.getState().removePhoto();

      const after = useNoteStore.getState().note!;
      expect(after.photo_operation).toBe('remove');
    });

    it('5. 純粋local-only写真（一度もserver linkしていない） → 削除 → server unlink不要（operation=none）', async () => {
      const { useNoteStore } = await import('../src/store/noteStore');
      useNoteStore.getState().setNote({
        ...newWineNote(),
        d1_note_id: null,
        photo_asset_id: null,
        photo_server_linked: false,
        photo_sync_status: 'local',
        photo_operation: 'sync',
      });

      useNoteStore.getState().removePhoto();

      const after = useNoteStore.getState().note!;
      expect(after.photo_operation).toBe('none');
    });
  });

  it('24. server未linkの写真解除はローカルidentityを即clearする（local-only）', async () => {
    const { useNoteStore } = await import('../src/store/noteStore');
    useNoteStore.getState().setNote({
      ...newWineNote(),
      label_photo_url: 'data:image/jpeg;base64,X',
      photo_asset_id: null,
      photo_sync_status: 'local',
      photo_operation: 'sync',
      photo_original_base64: 'X',
      photo_original_filename: 'a.jpg',
      photo_original_mime_type: 'image/jpeg',
      photo_file_hash: 'e'.repeat(64),
      photo_request_id: 'req-1',
    });

    useNoteStore.getState().removePhoto();

    const after = useNoteStore.getState().note!;
    expect(after.label_photo_url).toBeNull();
    expect(after.photo_sync_status).toBe('none');
    expect(after.photo_operation).toBe('none');
    expect(after.photo_asset_id).toBeNull();
    expect(after.photo_original_base64).toBeNull();
    expect(after.photo_original_filename).toBe('');
    expect(after.photo_original_mime_type).toBe('');
    expect(after.photo_file_hash).toBeNull();
    expect(after.photo_request_id).toBeNull();
  });

  it('25/26. server-linked写真の解除はremoveへ保留し、unlinkまでidentityを保持する', async () => {
    const { useNoteStore } = await import('../src/store/noteStore');
    useNoteStore.getState().setNote({
      ...newWineNote(),
      label_photo_url: 'data:image/jpeg;base64,X',
      photo_asset_id: 'server-asset-1',
      photo_server_linked: true,
      photo_request_id: 'req-1',
      photo_file_hash: 'f'.repeat(64),
      photo_original_filename: 'a.jpg',
      photo_original_mime_type: 'image/jpeg',
      photo_sync_status: 'synced',
      photo_operation: 'none',
    });

    useNoteStore.getState().removePhoto();

    const after = useNoteStore.getState().note!;
    expect(after.label_photo_url).toBeNull();
    expect(after.photo_operation).toBe('remove');
    expect(after.photo_sync_status).toBe('local');
    expect(after.photo_sync_error_code).toBeNull();
    // unlink完了までidentityは保持する
    expect(after.photo_asset_id).toBe('server-asset-1');
    expect(after.photo_request_id).toBe('req-1');
    expect(after.photo_file_hash).toBe('f'.repeat(64));
  });

  it('removePhotoはnoteが無ければ何もしない', async () => {
    const { useNoteStore } = await import('../src/store/noteStore');
    useNoteStore.getState().clear();
    useNoteStore.getState().removePhoto();
    expect(useNoteStore.getState().note).toBeNull();
  });
});
