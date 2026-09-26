import { FIELD_ENTRIES_URL, FIELD_EDIT_OPTIONS_URL } from '../config';
import { TokenExpiredError } from './icarusApi';
import type {
  FieldEditOption,
  FieldEditPatch,
  FieldEntryDetail,
  FieldEntryHistoryItem,
} from '../types/fieldEntryEdit';

// Field Log 編集API（icarus-api src/fieldEntryEdit.ts）のクライアント。
// 編集者はクライアントから送らない（Workerが認証結果から決める）。変更前の値もWorkerがD1から確定する。

export class FieldEditConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FieldEditConflictError';
  }
}

const NETWORK_MESSAGE = '通信エラーが発生しました。もう一度お試しください。';

async function request(url: string, idToken: string, init: RequestInit = {}): Promise<Record<string, unknown>> {
  let res: Response;
  try {
    res = await fetch(url, {
      ...init,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}`, ...(init.headers ?? {}) },
    });
  } catch {
    throw new Error(NETWORK_MESSAGE);
  }
  if (res.status === 401) {
    throw new TokenExpiredError('ログインの有効期限が切れました。入力内容はこの画面に残っています。再度ログインしてください。');
  }
  let json: Record<string, unknown>;
  try {
    json = await res.json();
  } catch {
    throw new Error(`サーバーエラー (HTTP ${res.status})`);
  }
  if (res.status === 409 || json.code === 'EDIT_CONFLICT') {
    throw new FieldEditConflictError('他の人が先にこの記録を更新しました。');
  }
  if (res.status === 403) {
    throw new Error('この記録を編集する権限がありません。');
  }
  if (res.status === 404 || json.code === 'EDIT_NOT_FOUND') {
    throw new Error('記録が見つかりません。削除された可能性があります。');
  }
  if (json.status !== 'success') {
    throw new Error(typeof json.message === 'string' && json.message ? json.message : '保存に失敗しました。もう一度お試しください。');
  }
  return json;
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '');

export function parseFieldEntryDetail(raw: Record<string, unknown>): FieldEntryDetail {
  return {
    eventId: str(raw.event_id),
    food: str(raw.food),
    date: str(raw.date),
    place: str(raw.place),
    memo: str(raw.memo),
    large_category: str(raw.large_category),
    sub_category: str(raw.sub_category),
    phase: str(raw.phase),
    harvested: str(raw.harvested),
    identification_status: str(raw.identification_status),
    observed_parts: str(raw.observed_parts).split(',').map((p) => p.trim()).filter((p) => p.length > 0),
    subject_type: str(raw.subject_type),
    kigo: str(raw.kigo),
    createdBy: str(raw.created_by),
    updatedAt: str(raw.updated_at),
  };
}

export async function fetchFieldEntryDetail(eventId: string, idToken: string): Promise<FieldEntryDetail> {
  const json = await request(`${FIELD_ENTRIES_URL}/${encodeURIComponent(eventId)}`, idToken, { method: 'GET' });
  return parseFieldEntryDetail((json.entry as Record<string, unknown>) ?? {});
}

export async function fetchFieldEditOptions(idToken: string): Promise<FieldEditOption[]> {
  const json = await request(FIELD_EDIT_OPTIONS_URL, idToken, { method: 'GET' });
  return Array.isArray(json.options) ? (json.options as FieldEditOption[]) : [];
}

export type FieldEntryPatchOutcome = 'applied' | 'noChange' | 'alreadyApplied';

// 1件の編集。requestIdは同じ内容の再送（通信断後の再試行）では同じ値を使う → Workerが二重に書かない
export async function patchFieldEntry(
  eventId: string,
  body: { requestId: string; expectedUpdatedAt: string; changes: FieldEditPatch },
  idToken: string,
): Promise<FieldEntryPatchOutcome> {
  const json = await request(`${FIELD_ENTRIES_URL}/${encodeURIComponent(eventId)}`, idToken, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
  const outcome = json.outcome;
  return outcome === 'noChange' || outcome === 'alreadyApplied' ? outcome : 'applied';
}

export async function fetchFieldEntryHistory(eventId: string, idToken: string): Promise<FieldEntryHistoryItem[]> {
  const json = await request(`${FIELD_ENTRIES_URL}/${encodeURIComponent(eventId)}/history`, idToken, { method: 'GET' });
  return Array.isArray(json.items) ? (json.items as FieldEntryHistoryItem[]) : [];
}
