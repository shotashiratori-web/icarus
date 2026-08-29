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
