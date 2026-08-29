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
    wineId: note.wine_id,
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
//
// sync_status='syncing'は「今まさにこの関数内で進行中」を表すだけで、ブロック条件には使わない
// （synced以外はすべて送信対象）。同一セッション内の二重発火はinFlightだけで防ぐ——新しいApp
// instance起動直後はinFlightが空のため、前回instanceがsyncing状態のまま強制終了/crash/reload/
// OS killで残したNoteも、次回起動時のretryPendingWineTastingNotes(includeSyncing:true)経由で
// ここへ到達し、正しく再送される（stale syncing recovery）
export async function syncWineTastingNote(noteId: string, idToken: string | null): Promise<void> {
  if (!idToken || !navigator.onLine) return;
  if (inFlight.has(noteId)) return;

  const note = await getNote(noteId);
  if (!note || note.sync_status === 'synced') return;

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

export interface RetryPendingWineTastingNotesOptions {
  // App起動時のみtrue。同一App instance内での進行中request二重送信を避けるため、
  // online復帰時（呼び出し元がfalseのまま渡す＝デフォルト）はsyncingを対象に含めない。
  // 新しいinstanceが起動した時点で、前回instanceのnetwork requestはもはや信用できないため対象に含める
  includeSyncing?: boolean;
}

// アプリ起動時（authState=='ready'到達時）/ online復帰時に呼ぶ。
// 起動時: local・failed・syncing（stale syncing recovery）／online復帰時: local・failedのみ
export async function retryPendingWineTastingNotes(
  idToken: string | null,
  options: RetryPendingWineTastingNotesOptions = {},
): Promise<void> {
  if (!idToken || !navigator.onLine) return;
  const { includeSyncing = false } = options;
  const notes = await getAllNotes();
  const targets = notes.filter((n) =>
    n.sync_status === 'local' || n.sync_status === 'failed' || (includeSyncing && n.sync_status === 'syncing'),
  );
  for (const note of targets) {
    await syncWineTastingNote(note.id, idToken);
  }
}
