import type { HypothesisSnapshot } from '../terrain/hypothesis';
import { WORKER_URL } from '../config';
import { TokenExpiredError } from './icarusApi';
import type { ExplorationSession, Purpose, TargetInput } from '../exploration/types';

// Exploration History（icarus-api /exploration/*）。2 段送信: ① 原本 PUT（サーバーで hash 照合）② 登録 POST（冪等）

export const EXPLORATION_URL = `${WORKER_URL}/exploration`;

// 通信できなかった（圏外・タイムアウト）。段階はそのまま、あとで再送
export class ExplorationNetworkError extends Error {
  constructor() {
    super('通信できませんでした。電波のある所で自動的に送信します');
    this.name = 'ExplorationNetworkError';
  }
}

// サーバーが理由付きで断った／サーバーの不調
export class ExplorationApiError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'ExplorationApiError';
    this.status = status;
    this.code = code;
  }
  get retryable(): boolean {
    return this.status >= 500 || this.status === 429;
  }
}

async function request(url: string, init: RequestInit, idToken: string): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(url, { ...init, cache: 'no-store', headers: { ...(init.headers ?? {}), Authorization: `Bearer ${idToken}` } });
  } catch {
    throw new ExplorationNetworkError();
  }
  if (res.status === 401) throw new TokenExpiredError('ログインの有効期限が切れています');
  if (!res.ok) {
    let code = `HTTP_${res.status}`;
    let message = `サーバーエラー (HTTP ${res.status})`;
    try {
      const body = (await res.json()) as { code?: string; message?: string };
      if (body.code) code = body.code;
      if (body.message) message = body.message;
    } catch { /* JSON でない応答（ゲートウェイのエラー等） */ }
    throw new ExplorationApiError(res.status, code, message);
  }
  return res;
}

export async function putGpxOriginal(sha256: string, bytes: ArrayBuffer, idToken: string): Promise<{ sha256: string; bytes: number; alreadyStored: boolean }> {
  const res = await request(`${EXPLORATION_URL}/gpx/${sha256}`, { method: 'PUT', headers: { 'Content-Type': 'application/gpx+xml' }, body: bytes }, idToken);
  return res.json();
}

export async function getGpxStatus(sha256: string, idToken: string): Promise<{ stored: boolean; bytes: number | null; sessionId: string | null }> {
  return (await request(`${EXPLORATION_URL}/gpx/${sha256}`, { method: 'GET' }, idToken)).json();
}

export interface CreateSessionBody {
  requestId: string;
  gpxSha256: string;
  explorerNames: string[];
  purpose: Purpose;
  memo: string;
  exploredOn?: string;
  targets: TargetInput[];
  source?: 'upload' | 'yamap_import';
  importBatchId?: string;
  hypothesis?: HypothesisSnapshot;
}

export async function createExplorationSession(body: CreateSessionBody, idToken: string): Promise<{ outcome: 'applied' | 'alreadyApplied' | 'duplicate'; item: ExplorationSession }> {
  const res = await request(`${EXPLORATION_URL}/sessions`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, idToken);
  return res.json();
}

export async function listExplorationSessions(params: Record<string, string>, idToken: string): Promise<ExplorationSession[]> {
  const qs = new URLSearchParams(params).toString();
  const body = (await (await request(`${EXPLORATION_URL}/sessions${qs ? `?${qs}` : ''}`, { method: 'GET' }, idToken)).json()) as { items: ExplorationSession[] };
  return body.items ?? [];
}

// 表示用の間引いた軌跡: [[lat, lng, ele|null, 秒|null], …] のセグメント配列
export async function fetchExplorationTrack(sessionId: string, idToken: string): Promise<[number, number][][]> {
  const raw = (await (await request(`${EXPLORATION_URL}/sessions/${encodeURIComponent(sessionId)}/track`, { method: 'GET' }, idToken)).json()) as number[][][];
  return raw.map((seg) => seg.map((p) => [p[0], p[1]] as [number, number]));
}

// 探索の記録の訂正（共通の編集契約）。S4b では仮説の付け替え・外す（null）に使う。端末には保存しない（電波のある時だけ）
export async function patchExplorationSession(
  sessionId: string, body: { requestId: string; expectedUpdatedAt: string; changes: Record<string, unknown> }, idToken: string,
): Promise<{ outcome: string; updatedAt?: string }> {
  const res = await request(`${EXPLORATION_URL}/sessions/${encodeURIComponent(sessionId)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, idToken);
  return res.json();
}

export async function fetchExplorationSession(sessionId: string, idToken: string): Promise<ExplorationSession> {
  return ((await (await request(`${EXPLORATION_URL}/sessions/${encodeURIComponent(sessionId)}`, { method: 'GET' }, idToken)).json()) as { item: ExplorationSession }).item;
}
