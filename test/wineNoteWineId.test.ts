import { describe, expect, it } from 'vitest';
import { newWineNote } from '../src/types/wine';
import { normalizeNote } from '../src/db/localDB';
import type { WineNote } from '../src/types/wine';

// Tasting Note Persistence v1（Stage 1C-A）。WineNote.wine_idの初期値・legacy互換を検証する。

describe('newWineNote', () => {
  it('1. wine_idの初期値はnull', () => {
    const note = newWineNote();
    expect(note.wine_id).toBeNull();
  });
});

describe('normalizeNote（legacy Note互換）', () => {
  it('2. wine_idフィールド自体が無いlegacy Noteは、読み込み時にnullとして扱う', () => {
    // Stage 1C-A以前に保存されたNoteはwine_idフィールドを持たない（IndexedDBはschemaless）。
    // `as unknown as WineNote`でその状態を意図的に再現する
    const legacy = { ...newWineNote() } as Partial<WineNote>;
    delete legacy.wine_id;
    const normalized = normalizeNote(legacy as WineNote);
    expect(normalized.wine_id).toBeNull();
  });

  it('wine_idが既に設定済みのNoteはそのまま保持する', () => {
    const note = { ...newWineNote(), wine_id: 'wine-123' };
    expect(normalizeNote(note).wine_id).toBe('wine-123');
  });

  it('wine_id以外のフィールドは変更しない', () => {
    const note = newWineNote();
    const normalized = normalizeNote(note);
    expect(normalized).toEqual(note);
  });
});
