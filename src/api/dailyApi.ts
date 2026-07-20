import {
  DAILY_TODAY_URL, DAILY_SUBMIT_URL, DAILY_ADMIN_LIST_URL,
  DAILY_ADMIN_COMMENT_URL, DAILY_ADMIN_CONFIRM_URL, DAILY_ADMIN_REQUEST_MORE_URL,
} from '../config';
import type {
  DailyEntry, DailyTodaySuccess, DailySubmitPayload, DailySubmitSuccess,
  DailyListSuccess, DailyActionSuccess, DailyError, DailyStatus,
} from '../types/daily';
import { TokenExpiredError } from './icarusApi';
import { NetworkUnknownError } from './workApi';

export class DailyAlreadyConfirmedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DailyAlreadyConfirmedError';
  }
}

export class ForbiddenRoleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ForbiddenRoleError';
  }
}

function throwForError(json: DailyError): never {
  if (json.code === 'DAILY_ALREADY_CONFIRMED') throw new DailyAlreadyConfirmedError(json.message);
  if (json.code === 'FORBIDDEN_ROLE') throw new ForbiddenRoleError(json.message);
  throw new Error(json.message || '操作に失敗しました');
}

export async function fetchTodayDaily(idToken: string): Promise<DailyEntry | null> {
  let res: Response;
  try {
    res = await fetch(DAILY_TODAY_URL, { method: 'GET', headers: { Authorization: `Bearer ${idToken}` } });
  } catch {
    throw new NetworkUnknownError();
  }
  if (res.status === 401) {
    throw new TokenExpiredError('ログインセッションが切れました。再度ログインしてください。');
  }
  let json: DailyTodaySuccess | DailyError;
  try {
    json = await res.json();
  } catch {
    throw new Error(`サーバーエラー (HTTP ${res.status})`);
  }
  if (json.status !== 'success') throwForError(json);
  return json.item;
}

export async function submitDaily(payload: DailySubmitPayload, idToken: string): Promise<DailyEntry> {
  let res: Response;
  try {
    res = await fetch(DAILY_SUBMIT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
      body: JSON.stringify(payload),
    });
  } catch {
    throw new NetworkUnknownError();
  }
  if (res.status === 401) {
    throw new TokenExpiredError('ログインセッションが切れました。再度ログインしてください。');
  }
  let json: DailySubmitSuccess | DailyError;
  try {
    json = await res.json();
  } catch {
    throw new Error(`サーバーエラー (HTTP ${res.status})`);
  }
  if (json.status !== 'success') throwForError(json);
  return json.item;
}

export interface DailyAdminListFilter {
  status?: DailyStatus;
  staffEmail?: string;
  date?: string;
}

export async function fetchDailyList(filter: DailyAdminListFilter, idToken: string): Promise<DailyEntry[]> {
  const params = new URLSearchParams();
  if (filter.status) params.set('status', filter.status);
  if (filter.staffEmail) params.set('staffEmail', filter.staffEmail);
  if (filter.date) params.set('date', filter.date);
  const url = params.toString() ? `${DAILY_ADMIN_LIST_URL}?${params.toString()}` : DAILY_ADMIN_LIST_URL;

  let res: Response;
  try {
    res = await fetch(url, { method: 'GET', headers: { Authorization: `Bearer ${idToken}` } });
  } catch {
    throw new NetworkUnknownError();
  }
  if (res.status === 401) {
    throw new TokenExpiredError('ログインセッションが切れました。再度ログインしてください。');
  }
  let json: DailyListSuccess | DailyError;
  try {
    json = await res.json();
  } catch {
    throw new Error(`サーバーエラー (HTTP ${res.status})`);
  }
  if (json.status !== 'success') throwForError(json);
  return json.items;
}

async function dailyAdminPost(url: string, idToken: string, payload: unknown): Promise<void> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
      body: JSON.stringify(payload),
    });
  } catch {
    throw new NetworkUnknownError();
  }
  if (res.status === 401) {
    throw new TokenExpiredError('ログインセッションが切れました。再度ログインしてください。');
  }
  let json: DailyActionSuccess | DailyError;
  try {
    json = await res.json();
  } catch {
    throw new Error(`サーバーエラー (HTTP ${res.status})`);
  }
  if (json.status !== 'success') throwForError(json);
}

export async function commentOnDaily(id: number, comment: string, idToken: string): Promise<void> {
  return dailyAdminPost(DAILY_ADMIN_COMMENT_URL, idToken, { id, comment });
}

export async function confirmDaily(id: number, comment: string | undefined, idToken: string): Promise<void> {
  return dailyAdminPost(DAILY_ADMIN_CONFIRM_URL, idToken, { id, comment });
}

export async function requestMoreOnDaily(id: number, comment: string, idToken: string): Promise<void> {
  return dailyAdminPost(DAILY_ADMIN_REQUEST_MORE_URL, idToken, { id, comment });
}
