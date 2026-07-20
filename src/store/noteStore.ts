import { create } from 'zustand';
import type { WineNote, MixedFieldData } from '../types/wine';
import { saveNote } from '../db/localDB';

type NoteStore = {
  note: WineNote | null;
  isDirty: boolean;

  setNote: (note: WineNote) => void;
  updateField: (fieldId: keyof WineNote['fields'], data: Partial<MixedFieldData>) => void;
  setPhoto: (url: string | null) => void;
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
    const { note } = get();
    if (!note) return;
    await saveNote(note);
    set({ isDirty: false });
  },

  clear: () => set({ note: null, isDirty: false }),
}));
