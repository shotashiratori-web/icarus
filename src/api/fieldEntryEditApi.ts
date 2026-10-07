import { FIELD_ENTRIES_URL, FIELD_EDIT_OPTIONS_URL, FIELD_BULK_EDIT_URL } from '../config';
import { TokenExpiredError } from './icarusApi';
import type {
  FieldBulkEditResponse,
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

// 無効化された記録への操作（409 ENTRY_VOIDED）。「他の人が先に更新」とは別に扱う
export class FieldEntryVoidedError extends Error {
  constructor(message = 'この記録は無効化されています。') {
    super(message);
    this.name = 'FieldEntryVoidedError';
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
  if (json.code === 'ENTRY_VOIDED') {
    throw new FieldEntryVoidedError();
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
    status: raw.status === 'voided' ? 'voided' : 'active',
    voidedAt: str(raw.voided_at),
    voidedByName: str(raw.voided_by_name),
    voidReason: str(raw.void_reason),
  };
}

// 記録の無効化（管理者だけ・理由必須）。記録は消さず、図鑑・一覧・地図から外れる。
// 返り値の linkedSpotCount = この記録を根拠にしている Environment Spot の数（Spot と写真は残る）
export async function voidFieldEntry(
  eventId: string,
  body: { requestId: string; expectedUpdatedAt: string; reason: string },
  idToken: string,
): Promise<{ updatedAt: string; linkedSpotCount: number }> {
  const json = await request(`${FIELD_ENTRIES_URL}/${encodeURIComponent(eventId)}/void`, idToken, { method: 'POST', body: JSON.stringify(body) });
  return { updatedAt: str(json.updatedAt), linkedSpotCount: typeof json.linkedSpotCount === 'number' ? json.linkedSpotCount : 0 };
}

// 一覧（地図の重複・一括写真整理）から無効化する時: その時点の updatedAt を読み直してから無効化する（楽観ロック）。
// 既に無効化されていれば FieldEntryVoidedError
export async function voidFieldEntryLatest(
  eventId: string,
  reason: string,
  idToken: string,
  requestId: string = crypto.randomUUID(),
): Promise<{ updatedAt: string; linkedSpotCount: number }> {
  const d = await fetchFieldEntryDetail(eventId, idToken);
  if (d.status === 'voided') throw new FieldEntryVoidedError();
  return voidFieldEntry(eventId, { requestId, expectedUpdatedAt: d.updatedAt, reason }, idToken);
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

// まとめて編集（POST /field/entries/bulk-edit）。記録ごとに独立して成立する（部分成功が正常な契約）。
// Worker側は各記録のrequestIdを `${requestId}:${eventId}` にするため、同じrequestIdで再送すると
// 成立済みの記録はalreadyAppliedになり二重に書かれない
export async function bulkEditFieldEntries(
  body: { requestId: string; entries: { eventId: string; expectedUpdatedAt: string }[]; changes: FieldEditPatch },
  idToken: string,
): Promise<FieldBulkEditResponse> {
  const json = await request(FIELD_BULK_EDIT_URL, idToken, { method: 'POST', body: JSON.stringify(body) });
  const results = Array.isArray(json.results) ? (json.results as Record<string, unknown>[]) : [];
  return {
    bulkId: typeof json.bulkId === 'string' ? json.bulkId : body.requestId,
    results: results.map((r) => ({
      eventId: typeof r.eventId === 'string' ? r.eventId : '',
      ok: r.ok === true,
      outcome: r.ok === true && (r.outcome === 'applied' || r.outcome === 'noChange' || r.outcome === 'alreadyApplied') ? r.outcome : undefined,
      code: typeof r.code === 'string' ? r.code : undefined,
      message: typeof r.message === 'string' ? r.message : '',
    })),
  };
}

// 1件の変更を保存して、保存後のD1の値を返す（一括写真の整理用。画面側がupdated_atを持っていない場合は保存直前に読む）
export async function saveFieldEntryChanges(
  eventId: string,
  changes: FieldEditPatch,
  idToken: string,
  opts: { expectedUpdatedAt?: string; requestId: string },
): Promise<FieldEntryDetail> {
  const expectedUpdatedAt = opts.expectedUpdatedAt ?? (await fetchFieldEntryDetail(eventId, idToken)).updatedAt;
  await patchFieldEntry(eventId, { requestId: opts.requestId, expectedUpdatedAt, changes }, idToken);
  return fetchFieldEntryDetail(eventId, idToken);
}
