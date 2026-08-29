import { create } from 'zustand';
import type { WineNote, MixedFieldData } from '../types/wine';
import { saveNote } from '../db/localDB';

type NoteStore = {
  note: WineNote | null;
  isDirty: boolean;

  setNote: (note: WineNote) => void;
  updateField: (fieldId: keyof WineNote['fields'], data: Partial<MixedFieldData>) => void;
  setPhoto: (url: string | null) => void;
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
