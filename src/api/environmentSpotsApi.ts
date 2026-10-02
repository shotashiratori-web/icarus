import { WORKER_URL } from '../config';
import { TokenExpiredError } from './icarusApi';
import type { EnvSpeciesItem, EnvironmentSpot, ObservationInput, SpotCreateBody, SpotObservation } from '../environmentSpots/types';

// Environment Spots（icarus-api /environment-spots・/environment-species・/spot-observations、S3）

export const ENV_SPOTS_URL = `${WORKER_URL}/environment-spots`;

// 通信できなかった（圏外・タイムアウト）。段階はそのまま、あとで再送
export class SpotNetworkError extends Error {
  constructor() {
    super('通信できませんでした。電波のある所で自動的に送信します');
    this.name = 'SpotNetworkError';
  }
}

export class SpotApiError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'SpotApiError';
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
    res = await fetch(url, { ...init, cache: 'no-store', headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}), Authorization: `Bearer ${idToken}` } });
  } catch {
    throw new SpotNetworkError();
  }
  if (res.status === 401) throw new TokenExpiredError('ログインの有効期限が切れています');
  if (!res.ok) {
    let code = `HTTP_${res.status}`;
    let message = `サーバーエラー (HTTP ${res.status})`;
    try {
      const body = (await res.json()) as { code?: string; message?: string };
      if (body.code) code = body.code;
      if (body.message) message = body.message;
    } catch { /* JSON でない応答 */ }
    throw new SpotApiError(res.status, code, message);
  }
  return res;
}

export async function fetchEnvSpecies(idToken: string): Promise<EnvSpeciesItem[]> {
  return ((await (await request(`${WORKER_URL}/environment-species`, { method: 'GET' }, idToken)).json()) as { items: EnvSpeciesItem[] }).items;
}

export async function fetchEnvironmentSpots(idToken: string, bbox?: [number, number, number, number]): Promise<EnvironmentSpot[]> {
  const q = bbox ? `?bbox=${bbox.join(',')}` : '';
  return ((await (await request(`${ENV_SPOTS_URL}${q}`, { method: 'GET' }, idToken)).json()) as { items: EnvironmentSpot[] }).items;
}

export async function fetchEnvironmentSpot(id: string, idToken: string): Promise<EnvironmentSpot> {
  return ((await (await request(`${ENV_SPOTS_URL}/${encodeURIComponent(id)}`, { method: 'GET' }, idToken)).json()) as { item: EnvironmentSpot }).item;
}

export async function createEnvironmentSpot(body: SpotCreateBody, idToken: string): Promise<{ outcome: string; item: EnvironmentSpot }> {
  return (await request(ENV_SPOTS_URL, { method: 'POST', body: JSON.stringify(body) }, idToken)).json();
}

export async function addSpotObservation(spotId: string, body: ObservationInput & { requestId: string }, idToken: string): Promise<{ outcome: string; item: SpotObservation }> {
  return (await request(`${ENV_SPOTS_URL}/${encodeURIComponent(spotId)}/observations`, { method: 'POST', body: JSON.stringify(body) }, idToken)).json();
}

// 登録済みスポットへの写真の追加（先に /assets で登録・アップロード済みの assetId を渡す）
export async function addEnvironmentSpotPhotos(spotId: string, body: { requestId: string; assetIds: string[]; fieldLogEventId?: string }, idToken: string): Promise<{ outcome: string; added?: string[] }> {
  return (await request(`${ENV_SPOTS_URL}/${encodeURIComponent(spotId)}/photos`, { method: 'POST', body: JSON.stringify(body) }, idToken)).json();
}

// 訂正（共通の編集契約: requestId・expectedUpdatedAt・changes・reason）。訂正は端末に保存せず、電波のある時だけ
export interface EditRequest {
  requestId: string;
  expectedUpdatedAt: string;
  changes: Record<string, unknown>;
  reason?: string;
}

export async function patchEnvironmentSpot(id: string, body: EditRequest, idToken: string): Promise<{ outcome: string; updatedAt?: string }> {
  return (await request(`${ENV_SPOTS_URL}/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(body) }, idToken)).json();
}

export async function patchSpotObservation(id: string, body: EditRequest, idToken: string): Promise<{ outcome: string }> {
  return (await request(`${WORKER_URL}/spot-observations/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(body) }, idToken)).json();
}

export function editErrorMessage(e: unknown): string {
  if (e instanceof SpotNetworkError) return '通信できませんでした。訂正は電波のある所で行ってください（訂正は端末に保存しません）';
  if (e instanceof SpotApiError) {
    if (e.code === 'EDIT_CONFLICT') return '他の人が先にこの記録を更新しました。閉じて開き直してから訂正してください';
    if (e.code === 'EDIT_FORBIDDEN') return '無効化は管理者のみ利用できます';
    return e.message;
  }
  return e instanceof Error ? e.message : '訂正できませんでした';
}
