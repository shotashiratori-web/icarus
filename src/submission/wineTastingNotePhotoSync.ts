import { getAllNotes, getNote, saveNote } from '../db/localDB';
import { submitWithFallback } from './orchestrator';
import type { WineTastingNotePhotoSubmissionPayload } from './adapters/wineTastingNotePhotoAdapter';

// 本文用inFlight（wineTastingNoteSync.ts）とは別に持つ。写真retryは本文retryとは独立した単位のため
const inFlight = new Set<string>();

// itemId生成規則。本文（wineTastingNote entity, itemId=note.id）とsubmission_queue上で衝突しないよう、
// 同じnote.idにサフィックスを付けて区別する
function photoItemId_(noteId: string): string {
  return `${noteId}:photo`;
}

// 未ログイン/オフラインなら何もしない。d1_note_id未確定（本文未同期）ならskip（Stage 9/26: 本文sync完了待ち、
// 失敗扱いにもしない）。UNSUPPORTED_MEDIA_TYPEは恒久的失敗のため自動retry対象外（Stage 24）
//
// inFlight.add()は最初のawaitより前、同期的に行う。has()チェックとadd()の間にawaitを挟むと、
// 同時に呼ばれた2回目の呼び出しがhas()チェック時点でまだ登録されていないinFlightを通過してしまう
// （check-then-actの非atomic競合）。そのため他の判定（getNote等）より先にinFlightだけを確定させる
export async function syncWineTastingNotePhoto(noteId: string, idToken: string | null): Promise<void> {
  if (!idToken || !navigator.onLine) return;
  if (inFlight.has(noteId)) return;
  inFlight.add(noteId);

  try {
    const note = await getNote(noteId);
    if (!note || note.photo_operation === 'none') return;
    if (!note.d1_note_id) return;
    if (note.photo_sync_error_code === 'UNSUPPORTED_MEDIA_TYPE') return;

    if (note.photo_sync_status !== 'uploading') {
      await saveNote({ ...note, photo_sync_status: 'uploading', photo_sync_error_code: null });
    }

    const payload: WineTastingNotePhotoSubmissionPayload = { noteId };
    await submitWithFallback({
      entity: 'wineTastingNotePhoto',
      itemId: photoItemId_(noteId),
      payload,
      title: note.fields.wine_name.text || 'テイスティングノート写真',
      idToken,
    });
    // 成功/失敗いずれの最終状態も、adapter自身がsaveNote()済み（raw errorへアクセスできる
    //唯一の場所であるadapter内でしかphoto_sync_error_codeを正確に分類できないため）
  } finally {
    inFlight.delete(noteId);
  }
}

export interface RetryPendingWineTastingNotePhotosOptions {
  // startup時のみtrue。前回instanceがuploadingのまま終了した場合の復旧（Stage 28）。
  // online復帰時は同一instance内で進行中の可能性があるため対象に含めない（Stage 1Bのsyncing recoveryと同型）
  includeUploading?: boolean;
}

export async function retryPendingWineTastingNotePhotos(
  idToken: string | null,
  options: RetryPendingWineTastingNotePhotosOptions = {},
): Promise<void> {
  if (!idToken || !navigator.onLine) return;
  const { includeUploading = false } = options;
  const notes = await getAllNotes();
  const targets = notes.filter((n) => {
    if (n.photo_operation === 'none') return false;
    if (!n.d1_note_id) return false;
    if (n.photo_sync_error_code === 'UNSUPPORTED_MEDIA_TYPE') return false;
    if (n.photo_sync_status === 'local' || n.photo_sync_status === 'failed') return true;
    if (includeUploading && n.photo_sync_status === 'uploading') return true;
    return false;
  });
  for (const note of targets) {
    await syncWineTastingNotePhoto(note.id, idToken);
  }
}
