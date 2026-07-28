import { SPOTS_URL } from '../config';
import type { SpotEntity, SpotListSuccess, SpotItemSuccess, SpotActionSuccess, SpotError, SpotFormInput } from '../types/spotEntity';
import { TokenExpiredError } from './icarusApi';
import { NetworkUnknownError } from './workApi';

export class SpotValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SpotValidationError';
  }
}

export class SpotNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SpotNotFoundError';
  }
}

function throwForError(json: SpotError): never {
  if (json.code === 'SPOT_VALIDATION_ERROR') throw new SpotValidationError(json.message);
  if (json.code === 'SPOT_NOT_FOUND') throw new SpotNotFoundError(json.message);
  throw new Error(json.message || '操作に失敗しました');
}

async function request<T>(url: string, idToken: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      ...init,
      headers: { ...(init?.headers ?? {}), Authorization: `Bearer ${idToken}` },
    });
  } catch {
    throw new NetworkUnknownError();
  }
  if (res.status === 401) {
    throw new TokenExpiredError('ログインセッションが切れました。再度ログインしてください。');
  }
  let json: T | SpotError;
  try {
    json = await res.json();
  } catch {
    throw new Error(`サーバーエラー (HTTP ${res.status})`);
  }
  if ((json as SpotError).status === 'error') throwForError(json as SpotError);
  return json as T;
}

export interface SpotListFilter {
  q?: string;
  status?: 'active' | 'archived';
}

export async function fetchSpots(filter: SpotListFilter, idToken: string): Promise<SpotEntity[]> {
  const params = new URLSearchParams();
  if (filter.q) params.set('q', filter.q);
  if (filter.status) params.set('status', filter.status);
  const url = params.toString() ? `${SPOTS_URL}?${params.toString()}` : SPOTS_URL;
  const json = await request<SpotListSuccess>(url, idToken, { method: 'GET' });
  return json.items;
}

export async function fetchSpot(id: string, idToken: string): Promise<SpotEntity> {
  const json = await request<SpotItemSuccess>(`${SPOTS_URL}/${encodeURIComponent(id)}`, idToken, { method: 'GET' });
  return json.item;
}

export async function createSpot(input: SpotFormInput, idToken: string): Promise<SpotEntity> {
  const json = await request<SpotItemSuccess>(SPOTS_URL, idToken, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return json.item;
}

export async function updateSpot(id: string, input: SpotFormInput, idToken: string): Promise<SpotEntity> {
  const json = await request<SpotItemSuccess>(`${SPOTS_URL}/${encodeURIComponent(id)}`, idToken, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return json.item;
}

export async function deleteSpot(id: string, idToken: string): Promise<void> {
  await request<SpotActionSuccess>(`${SPOTS_URL}/${encodeURIComponent(id)}`, idToken, { method: 'DELETE' });
}
