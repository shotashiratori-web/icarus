import { TokenExpiredError } from '../api/icarusApi';
import {
  createExplorationSession, ExplorationApiError, ExplorationNetworkError, putGpxOriginal,
} from '../api/explorationApi';
import { findPendingBySha, getPending, listPending, putPending, updatePending } from './pendingStore';
import { LocalGpxError, previewGpx, sha256Hex } from './gpxLocal';
import type { PendingError, PendingExploration, Purpose, TargetInput } from './types';

// Exploration History の送信機構（Stage 2 Web、設計 §4）。登録の経路はこれ 1 つ:
//   GPX を選ぶ → まず端末（IndexedDB）に原本を保存（通信しない）→ 送信（通信できれば即時、できなければあとで自動）
// 送信は 2 段。どこで止まっても、端末に残った段階から再開する:
//   saved        →（① PUT /exploration/gpx/:sha256。サーバーが hash を照合）→ gpx_uploaded
//   gpx_uploaded →（② POST /exploration/sessions。requestId = 端末の id で冪等）→ registered
// 「登録済み」にするのは、② の応答の gpxSha256 が端末の SHA-256 と一致した時だけ

export interface NewExplorationInput {
  fileName: string;
  bytes: ArrayBuffer;
  explorerNames: string[];
  purpose: Purpose;
  memo: string;
  targets: Omit<TargetInput, 'requestId'>[];
  source?: 'upload' | 'yamap_import';
  importBatchId?: string | null;
}

// 端末に保存する（通信しない）。同じ GPX（SHA-256 一致）がすでに端末にあれば、それを返して新しく作らない。
// GPX として読めないものは保存しない（LocalGpxError）。ready=false は下書き（入力が済むまで送らない）
export async function saveNewExploration(input: NewExplorationInput, ready = true): Promise<{ record: PendingExploration; existing: boolean }> {
  const sha256 = await sha256Hex(input.bytes);
  const existing = await findPendingBySha(sha256);
  if (existing) return { record: existing, existing: true };
  const preview = previewGpx(input.bytes); // 読めなければ LocalGpxError（保存しない）
  const now = new Date().toISOString();
  const record: PendingExploration = {
    id: crypto.randomUUID(),
    fileName: input.fileName,
    gpx: input.bytes.slice(0),
    sha256,
    bytes: input.bytes.byteLength,
    explorerNames: input.explorerNames,
    purpose: input.purpose,
    memo: input.memo,
    exploredOnManual: null,
    targets: input.targets.map((t) => ({ ...t, requestId: crypto.randomUUID() })),
    preview,
    ready,
    source: input.source ?? 'upload',
    importBatchId: input.importBatchId ?? null,
    stage: 'saved',
    sessionId: null,
    lastError: null,
    attempts: 0,
    createdAt: now,
    updatedAt: now,
    gpxUploadedAt: null,
    registeredAt: null,
  };
  await putPending(record);
  return { record, existing: false };
}

export { LocalGpxError };

// 下書き（GPX を選んだ直後に保存したもの）に入力内容を入れて、送信できる状態にする
export async function finalizeDraft(id: string, meta: Pick<NewExplorationInput, 'explorerNames' | 'purpose' | 'memo' | 'targets'> & { exploredOnManual?: string | null }): Promise<PendingExploration | undefined> {
  const cur = await getPending(id);
  if (!cur) return undefined;
  if (cur.stage !== 'saved') return cur; // 送信が始まったものは入力内容を変えない（登録内容と端末の記録がずれないように）
  return updatePending(id, {
    explorerNames: meta.explorerNames,
    purpose: meta.purpose,
    memo: meta.memo,
    targets: meta.targets.map((t) => ({ ...t, requestId: crypto.randomUUID() })),
    exploredOnManual: meta.exploredOnManual ?? cur.exploredOnManual,
    ready: true,
    lastError: null,
  });
}

// 再送しても直らない失敗（利用者の対応が要る）
export class ExplorationRejectedError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'ExplorationRejectedError';
    this.code = code;
  }
}

const inFlight = new Map<string, Promise<PendingExploration>>();

// 1 件を進められるところまで進める。同じ記録の同時実行は 1 本にまとめる。失敗は端末に記録してから投げる
export function syncPending(id: string, idToken: string): Promise<PendingExploration> {
  const running = inFlight.get(id);
  if (running) return running;
  const p = runStages(id, idToken).finally(() => inFlight.delete(id));
  inFlight.set(id, p);
  return p;
}

function errorOf(e: unknown): PendingError {
  const at = new Date().toISOString();
  if (e instanceof TokenExpiredError) return { code: 'AUTH_EXPIRED', message: 'ログインが必要です。ログインすると自動で送信します', retryable: true, at };
  if (e instanceof ExplorationNetworkError) return { code: 'NETWORK_ERROR', message: e.message, retryable: true, at };
  if (e instanceof ExplorationRejectedError) return { code: e.code, message: e.message, retryable: false, at };
  if (e instanceof ExplorationApiError) {
    return e.retryable
      ? { code: e.code, message: `サーバーの都合で送信できませんでした（${e.status}）。あとで自動的に送信します`, retryable: true, at }
      : { code: e.code, message: e.message, retryable: false, at };
  }
  return { code: 'UNKNOWN', message: e instanceof Error ? e.message : '送信できませんでした', retryable: true, at };
}

async function runStages(id: string, idToken: string): Promise<PendingExploration> {
  let p = await getPending(id);
  if (!p) throw new ExplorationRejectedError('PENDING_NOT_FOUND', '端末に記録がありません');
  if (p.stage === 'registered') return p;
  if (!p.ready) throw new ExplorationRejectedError('DRAFT_NOT_READY', '入力が済んでいないため、まだ送信しません');
  p = (await updatePending(id, { attempts: p.attempts + 1 }))!;
  try {
    for (let round = 0; round < 2; round++) {
      if (p.stage === 'saved') {
        // 端末の原本が保存時から変わっていないこと（壊れた原本を送らない）
        if ((await sha256Hex(p.gpx)) !== p.sha256) throw new ExplorationRejectedError('LOCAL_GPX_CORRUPTED', '端末の GPX が保存時と一致しません。GPX を選び直してください（元の記録は残します）');
        try {
          await putGpxOriginal(p.sha256, p.gpx, idToken);
        } catch (e) {
          if (e instanceof ExplorationApiError && !e.retryable) {
            const msg = e.code === 'GPX_HASH_MISMATCH' ? 'サーバーに届いた GPX が端末の記録と一致しませんでした（hash 不一致）。送り直してください'
              : e.code === 'GPX_TOO_LARGE' ? 'GPX が大きすぎます（10MB まで）'
                : e.code === 'GPX_INVALID' ? 'サーバーで GPX を読めませんでした'
                  : e.message;
            throw new ExplorationRejectedError(e.code, msg);
          }
          throw e;
        }
        p = (await updatePending(id, { stage: 'gpx_uploaded', gpxUploadedAt: new Date().toISOString(), lastError: null }))!;
      }
      if (p.stage === 'gpx_uploaded') {
        let res;
        try {
          res = await createExplorationSession({
            requestId: p.id,
            gpxSha256: p.sha256,
            explorerNames: p.explorerNames,
            purpose: p.purpose,
            memo: p.memo,
            ...(p.exploredOnManual ? { exploredOn: p.exploredOnManual } : {}),
            targets: p.targets,
            ...(p.source === 'yamap_import' ? { source: 'yamap_import' as const, ...(p.importBatchId ? { importBatchId: p.importBatchId } : {}) } : {}),
          }, idToken);
        } catch (e) {
          // 原本がサーバーに無い（消えた・別環境）→ ① からやり直す（1 回だけ）
          if (e instanceof ExplorationApiError && e.code === 'GPX_NOT_UPLOADED' && round === 0) {
            p = (await updatePending(id, { stage: 'saved', gpxUploadedAt: null }))!;
            continue;
          }
          if (e instanceof ExplorationApiError && e.code === 'EXPLORATION_NEEDS_DATE') {
            throw new ExplorationRejectedError(e.code, 'この GPX には時刻がありません。探索日を入力してから送信してください');
          }
          if (e instanceof ExplorationApiError && !e.retryable) throw new ExplorationRejectedError(e.code, e.message);
          throw e;
        }
        if (res.item.gpxSha256 !== p.sha256) {
          throw new ExplorationRejectedError('SESSION_HASH_MISMATCH', 'サーバーの登録内容が端末の GPX と一致しません');
        }
        p = (await updatePending(id, { stage: 'registered', sessionId: res.item.id, registeredAt: new Date().toISOString(), lastError: null }))!;
        return p;
      }
    }
    return p;
  } catch (e) {
    await updatePending(id, { lastError: errorOf(e) });
    throw e;
  }
}

// 利用者が対応した後（探索日の入力など）に、失敗の印を外して送り直せるようにする。段階は変えない
export async function clearFailure(id: string, patch: Partial<Pick<PendingExploration, 'exploredOnManual'>> = {}): Promise<void> {
  await updatePending(id, { ...patch, lastError: null });
}

// まだ登録済みでないもの（送信失敗を除く）を順に送る。起動時・オンライン復帰時・ログイン時に呼ぶ
export async function resumeAllPending(idToken: string | null, send: (id: string) => Promise<unknown>): Promise<number> {
  if (!idToken) return 0;
  const items = await listPending().catch(() => [] as PendingExploration[]);
  let n = 0;
  for (const p of items) {
    if (p.stage === 'registered' || !p.ready) continue;
    if (p.lastError && !p.lastError.retryable) continue;
    n++;
    await send(p.id).catch(() => undefined);
  }
  return n;
}
