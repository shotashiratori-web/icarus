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
});
