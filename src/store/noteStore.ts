import { create } from 'zustand';
import type { WineNote, MixedFieldData } from '../types/wine';
import { saveNote } from '../db/localDB';

type NoteStore = {
  note: WineNote | null;
  isDirty: boolean;

  setNote: (note: WineNote) => void;
  updateField: (fieldId: keyof WineNote['fields'], data: Partial<MixedFieldData>) => void;
  setPhoto: (url: string | null) => void;
  // Stage 1D-C: JPEG選択時。previewに加えOriginal/hash/metadataを保存し、写真sync対象にする。
  // 新しいFileは別Asset intentのため旧photo_asset_id/photo_request_idはリセットする（Stage 6/7）
  setPhotoSelected: (input: {
    previewUrl: string;
    originalBase64: string;
    filename: string;
    mimeType: string;
    fileHash: string;
  }) => void;
  // Stage 1D-C: HEIC等JPEG以外の選択時。previewは出すがsync対象外として即failedにする（Stage 9）
  setPhotoUnsupported: (input: { previewUrl: string; filename: string; mimeType: string }) => void;
  // Stage 1D-C: 写真削除。server未linkならローカルidentityを即clear（Stage 17）、
  // server-linkedならunlink完了までidentityを保持したままphoto_operation='remove'にする（Stage 18）。
  // 判定はphoto_server_linkedで行う（photo_asset_idは新写真選択のたびリセットされるcandidate用の
  // fieldであり、「serverに旧写真のlinkが残っているか」を表さないため。Pre-PR監査で修正）
  removePhoto: () => void;
  setWineId: (wineId: string | null) => void;
  setSyncStatus: (status: WineNote['sync_status']) => void;
  setNotionPageId: (id: string) => void;
  persist: () => Promise<void>;
  clear: () => void;
};

export const useNoteStore = create<NoteStore>((set, get) => ({
  note: null,
  isDirty: false,

  setNote: (note) => set({ note, isDirty: false }),

  updateField: (fieldId, data) => {
    const { note } = get();
    if (!note) return;
    set({
      note: {
        ...note,
        fields: {
          ...note.fields,
          [fieldId]: { ...note.fields[fieldId], ...data },
        },
      },
      isDirty: true,
    });
  },

  setPhoto: (url) => {
    const { note } = get();
    if (!note) return;
    set({ note: { ...note, label_photo_url: url }, isDirty: true });
  },

  setPhotoSelected: (input) => {
    const { note } = get();
    if (!note) return;
    set({
      note: {
        ...note,
        label_photo_url: input.previewUrl,
        photo_operation: 'sync',
        photo_sync_status: 'local',
        photo_sync_error_code: null,
        // 新しい写真は別Photo Asset intent。旧Assetへの参照は持ち込まない。
        // requestIdは新しいFileを選んだこの瞬間に発行する（Stage 7）。同じ写真のretryでは
        // adapter側が既存値をそのまま使い回すため、ここで再生成されることはない
        // 注意: photo_server_linkedはここで変更しない。旧写真が既にserver linkされていた場合、
        // 新写真を選んだだけではserver側のlinkは消えていないため（Pre-PR監査で明確化）
        photo_asset_id: null,
        photo_request_id: crypto.randomUUID(),
        photo_original_base64: input.originalBase64,
        photo_original_filename: input.filename,
        photo_original_mime_type: input.mimeType,
        photo_file_hash: input.fileHash,
      },
      isDirty: true,
    });
  },

  setPhotoUnsupported: (input) => {
    const { note } = get();
    if (!note) return;
    set({
      note: {
        ...note,
        label_photo_url: input.previewUrl,
        photo_operation: 'sync',
        photo_sync_status: 'failed',
        photo_sync_error_code: 'UNSUPPORTED_MEDIA_TYPE',
        photo_asset_id: null,
        photo_request_id: null,
        photo_original_base64: null,
        photo_original_filename: input.filename,
        photo_original_mime_type: input.mimeType,
        photo_file_hash: null,
      },
      isDirty: true,
    });
  },

  removePhoto: () => {
    const { note } = get();
    if (!note) return;
    if (note.photo_server_linked) {
      set({
        note: {
          ...note,
          label_photo_url: null,
          photo_operation: 'remove',
          photo_sync_status: 'local',
          photo_sync_error_code: null,
        },
        isDirty: true,
      });
      return;
    }
    set({
      note: {
        ...note,
        label_photo_url: null,
        photo_operation: 'none',
        photo_sync_status: 'none',
        photo_sync_error_code: null,
        photo_asset_id: null,
        photo_server_linked: false,
        photo_original_base64: null,
        photo_original_filename: '',
        photo_original_mime_type: '',
        photo_file_hash: null,
        photo_request_id: null,
      },
      isDirty: true,
    });
  },

  // Stage 1C-A: wine_idの設定/解除（null）。他のWine Entity fieldをsnapshotへ上書きしない
  // （記録時点の認識を保持する契約はStage 1Aのまま）
  setWineId: (wineId) => {
    const { note } = get();
    if (!note) return;
    set({ note: { ...note, wine_id: wineId }, isDirty: true });
  },

  setSyncStatus: (status) => {
    const { note } = get();
    if (!note) return;
    set({ note: { ...note, sync_status: status } });
  },

  setNotionPageId: (id) => {
    const { note } = get();
    if (!note) return;
    set({ note: { ...note, notion_page_id: id, sync_status: 'synced' } });
  },

  persist: async () => {
    const { note, isDirty } = get();
    if (!note) return;
    // 同期済みNoteを編集した場合、保存時にsync_status を'local'へ戻し再送対象にする
    // （Stage 1B: 編集後もsync_status='synced'のまま残ると、変更内容がサーバーへ反映されない）
    const toSave: WineNote = isDirty && note.sync_status === 'synced'
      ? { ...note, sync_status: 'local' }
      : note;
    await saveNote(toSave);
    set({ note: toSave, isDirty: false });
  },

  clear: () => set({ note: null, isDirty: false }),
}));
