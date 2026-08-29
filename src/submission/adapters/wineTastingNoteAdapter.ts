import { createWineTastingNote, updateWineTastingNote, type WineTastingNoteFieldsInput } from '../../api/wineTastingNoteApi';
import { getNote, saveNote } from '../../db/localDB';
import { registerAdapter } from '../registry';
import { mapIcarusApiError } from '../errorMapping';

// Tasting Note Persistence v1（Stage 1B）。requestId = WineNote.id（不変）。
// remoteId（d1_note_id）が無ければ新規POST、あればPATCH——同一requestIdへの内容変更POSTによる
// 409（Stage 1A idempotency契約）を避けるための分岐。
// Stage 1C-A: wineIdはnote.wine_idをそのまま渡す（nullable、接続はユーザー手動選択のみ）
export interface WineTastingNoteSubmissionPayload {
  requestId: string;
  remoteId: string | null;
  wineId: string | null;
  wineNameSnapshot: string;
  producerSnapshot: string;
  vintageSnapshot: string;
  tastingDate: string;
  location: string;
  aromaText: string;
  memoText: string;
  glassPrice: string;
  bottlePrice: string;
}

function toFieldsInput(payload: WineTastingNoteSubmissionPayload): WineTastingNoteFieldsInput {
  return {
    wineId: payload.wineId,
    tastingDate: payload.tastingDate,
    location: payload.location,
    wineNameSnapshot: payload.wineNameSnapshot,
    producerSnapshot: payload.producerSnapshot,
    vintageSnapshot: payload.vintageSnapshot,
    aromaText: payload.aromaText,
    memoText: payload.memoText,
    glassPrice: payload.glassPrice,
    bottlePrice: payload.bottlePrice,
  };
}

registerAdapter<WineTastingNoteSubmissionPayload>({
  entity: 'wineTastingNote',
  submit: async (payload, idToken) => {
    const fields = toFieldsInput(payload);

    if (payload.remoteId) {
      return updateWineTastingNote(payload.remoteId, fields, idToken);
    }

    const created = await createWineTastingNote({ requestId: payload.requestId, ...fields }, idToken);
    payload.remoteId = created.id;

    // ローカルNoteへd1_note_idを書き戻す。以後の再送/編集はPATCH経路になる
    const note = await getNote(payload.requestId);
    if (note) await saveNote({ ...note, d1_note_id: created.id });

    return created;
  },
  mapError: mapIcarusApiError,
});
