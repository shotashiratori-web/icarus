import { WINES_URL } from '../config';
import type { WineEntity, WineListSuccess, WineItemSuccess, WineActionSuccess, WineError, WineFormInput } from '../types/wineEntity';
import { TokenExpiredError } from './icarusApi';
import { NetworkUnknownError } from './workApi';

export class WineValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WineValidationError';
  }
}

export class WineNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WineNotFoundError';
  }
}

function throwForError(json: WineError): never {
  if (json.code === 'WINE_VALIDATION_ERROR') throw new WineValidationError(json.message);
  if (json.code === 'WINE_NOT_FOUND') throw new WineNotFoundError(json.message);
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
  let json: T | WineError;
  try {
    json = await res.json();
  } catch {
    throw new Error(`サーバーエラー (HTTP ${res.status})`);
  }
  if ((json as WineError).status === 'error') throwForError(json as WineError);
  return json as T;
}

export interface WineListFilter {
  q?: string;
  status?: 'active' | 'archived';
}

export async function fetchWines(filter: WineListFilter, idToken: string): Promise<WineEntity[]> {
  const params = new URLSearchParams();
  if (filter.q) params.set('q', filter.q);
  if (filter.status) params.set('status', filter.status);
  const url = params.toString() ? `${WINES_URL}?${params.toString()}` : WINES_URL;
  const json = await request<WineListSuccess>(url, idToken, { method: 'GET' });
  return json.items;
}

export async function fetchWine(id: string, idToken: string): Promise<WineEntity> {
  const json = await request<WineItemSuccess>(`${WINES_URL}/${encodeURIComponent(id)}`, idToken, { method: 'GET' });
  return json.item;
}

export async function createWine(input: WineFormInput, idToken: string): Promise<WineEntity> {
  const json = await request<WineItemSuccess>(WINES_URL, idToken, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return json.item;
}

export async function updateWine(id: string, input: WineFormInput, idToken: string): Promise<WineEntity> {
  const json = await request<WineItemSuccess>(`${WINES_URL}/${encodeURIComponent(id)}`, idToken, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return json.item;
}

export async function deleteWine(id: string, idToken: string): Promise<void> {
  await request<WineActionSuccess>(`${WINES_URL}/${encodeURIComponent(id)}`, idToken, { method: 'DELETE' });
}
