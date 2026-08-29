import { getAllNotes, getNote, saveNote } from '../db/localDB';
import type { WineNote } from '../types/wine';
import { submitWithFallback } from './orchestrator';
import type { WineTastingNoteSubmissionPayload } from './adapters/wineTastingNoteAdapter';

// 同一noteに対する同時多重発火（例: 保存ボタン連打とアプリ起動時再送が重なる）を
// このセッション内だけ防ぐ。永続化はしない——タブを跨いだ排他制御はStage 1Bの対象外
const inFlight = new Set<string>();

export function buildWineTastingNotePayload(note: WineNote): WineTastingNoteSubmissionPayload {
  const f = note.fields;
  return {
    requestId: note.id,
    remoteId: note.d1_note_id,
    wineNameSnapshot: f.wine_name.text,
    producerSnapshot: f.producer.text,
    vintageSnapshot: f.vintage.text,
    tastingDate: f.tasting_date.text,
    location: f.location.text,
    aromaText: f.aroma.text,
    memoText: f.memo.text,
    glassPrice: f.glass_price.text,
    bottlePrice: f.bottle_price.text,
  };
}

// 未ログイン/オフラインなら何もしない（sync_status='local'のまま、起動時/online復帰時の
// retryPendingWineTastingNotesに委ねる）。ログイン済み+オンラインならSubmission Frameworkへ送る
export async function syncWineTastingNote(noteId: string, idToken: string | null): Promise<void> {
  if (!idToken || !navigator.onLine) return;
  if (inFlight.has(noteId)) return;

  const note = await getNote(noteId);
  if (!note || note.sync_status === 'synced' || note.sync_status === 'syncing') return;

  inFlight.add(noteId);
  try {
    await saveNote({ ...note, sync_status: 'syncing' });

    const payload = buildWineTastingNotePayload(note);
    const result = await submitWithFallback({
      entity: 'wineTastingNote',
      itemId: note.id,
      payload,
      title: note.fields.wine_name.text || 'テイスティングノート',
      idToken,
    });

    // adapter成功時にd1_note_idが書き戻されている場合があるため、再度読み直してからsync_statusのみ更新する
    const latest = await getNote(noteId);
    if (!latest) return;
    await saveNote({ ...latest, sync_status: result.ok ? 'synced' : 'failed' });
  } finally {
    inFlight.delete(noteId);
  }
}

// アプリ起動時（authState=='ready'到達時）/ online復帰時に呼ぶ。local・failedのみが対象（Stage 1Bの完成条件12）
export async function retryPendingWineTastingNotes(idToken: string | null): Promise<void> {
  if (!idToken || !navigator.onLine) return;
  const notes = await getAllNotes();
  const targets = notes.filter((n) => n.sync_status === 'local' || n.sync_status === 'failed');
  for (const note of targets) {
    await syncWineTastingNote(note.id, idToken);
  }
}
