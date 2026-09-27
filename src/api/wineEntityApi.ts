import { WINES_URL } from '../config';
import type { WineEntity, WineListSuccess, WineItemSuccess, WineError, WineFormInput } from '../types/wineEntity';
import { TokenExpiredError } from './icarusApi';
import { NetworkUnknownError } from './workApi';
import { EDIT_ERROR_MESSAGES, throwIfEditError } from './editErrors';

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

// Wine Editing（2026-09-28）: 共通 API 契約の PATCH。変えた項目だけ・expectedUpdatedAt・requestId（同じ内容の再送は
// サーバーが二重に書かない）。409 は EditConflictError、403（staff の無効化）は EditForbiddenError。旧 PUT は使わない
export type WinePatchChanges = Partial<{
  title: string; producer: string; vintage: number | null; variety: string; origin: string;
  description: string; photos: string[]; tags: string[]; status: 'active' | 'archived';
}>;

export type WinePatchOutcome = 'applied' | 'noChange' | 'alreadyApplied';

export async function patchWine(
  id: string,
  body: { requestId: string; expectedUpdatedAt: string; changes: WinePatchChanges; reason?: string },
  idToken: string,
): Promise<WinePatchOutcome> {
  let res: Response;
  try {
    res = await fetch(`${WINES_URL}/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error(EDIT_ERROR_MESSAGES.network);
  }
  let json: Record<string, unknown> = {};
  try {
    json = await res.json();
  } catch {
    throw new Error(`サーバーエラー (HTTP ${res.status})`);
  }
  throwIfEditError(res.status, json);
  return json.outcome === 'noChange' || json.outcome === 'alreadyApplied' ? json.outcome : 'applied';
}

export interface WineHistoryItem {
  id: string;
  editedAt: string;
  editedByName: string;
  editedBy: string;
  source: string;
  reason: string | null;
  changes: { field: string; old: string | null; new: string | null }[];
}

export async function fetchWineHistory(id: string, idToken: string): Promise<WineHistoryItem[]> {
  let res: Response;
  try {
    res = await fetch(`${WINES_URL}/${encodeURIComponent(id)}/history`, { headers: { Authorization: `Bearer ${idToken}` } });
  } catch {
    throw new Error(EDIT_ERROR_MESSAGES.network);
  }
  let json: Record<string, unknown> = {};
  try {
    json = await res.json();
  } catch {
    throw new Error(`サーバーエラー (HTTP ${res.status})`);
  }
  throwIfEditError(res.status, json);
  return Array.isArray(json.items) ? (json.items as WineHistoryItem[]) : [];
}
