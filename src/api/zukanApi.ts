import { FIELD_LOGS_GEOJSON_URL, FIELD_DELETE_ENTRIES_URL, FIELD_UPDATE_ENTRY_URL } from '../config';
import { buildFieldLogId, type FieldLogEntry, type FieldLogGeoJson } from '../types/zukan';
import { TokenExpiredError } from './icarusApi';

export class NetworkUnknownError extends Error {
  constructor() {
    super('ネットワークエラーが発生しました。通信状況を確認してください。');
    this.name = 'NetworkUnknownError';
  }
}

export async function fetchFieldLogEntries(): Promise<FieldLogEntry[]> {
  let res: Response;
  try {
    res = await fetch(FIELD_LOGS_GEOJSON_URL, { method: 'GET' });
  } catch {
    throw new NetworkUnknownError();
  }

  let json: FieldLogGeoJson;
  try {
    json = await res.json();
  } catch {
    throw new Error(`サーバーエラー (HTTP ${res.status})`);
  }

  return json.features.map((f) => {
    const [lng, lat] = f.geometry.coordinates;
    const { foodName, place, date, memo, photoUrl, notionUrl, elevation, kigo, recordedAt, eventId, takenAt } = f.properties;
    return {
      id: buildFieldLogId(date, lat, lng, recordedAt),
      foodName, place, date, memo, photoUrl, notionUrl, elevation, kigo, lat, lng,
      recordedAt: recordedAt || '',
      eventId: eventId || '',
      takenAt: takenAt || '',
    };
  });
}

export interface FieldDeleteResultItem {
  eventId: string;
  status: 'deleted' | 'not_found';
  row?: number;
  notionArchived?: boolean;
  notionError?: string;
}

export interface FieldDeleteResult {
  deleted: number;
  notFound: number;
  results: FieldDeleteResultItem[];
}

// Field Log行の削除（管理者限定）。Sheets行の削除と対応するNotionページのアーカイブをまとめて行う
export async function deleteFieldLogEntries(eventIds: string[], idToken: string): Promise<FieldDeleteResult> {
  const res = await fetch(FIELD_DELETE_ENTRIES_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify({ eventIds }),
  });
  let json: { status: string; message?: string } & Partial<FieldDeleteResult>;
  try {
    json = await res.json();
  } catch {
    throw new Error(`削除に失敗しました (HTTP ${res.status})`);
  }
  if (json.status !== 'success') {
    throw new Error(json.message || '削除に失敗しました');
  }
  return { deleted: json.deleted ?? 0, notFound: json.notFound ?? 0, results: json.results ?? [] };
}

export interface FieldUpdateEntryChanges {
  memo?: string;
  foodName?: string;
  location?: string;
}

export interface FieldUpdateEntryResult {
  entryId: string;
  updatedFields: string[];
  noChange: boolean;
  sheetUpdated: boolean;
  notionSynced: boolean;
  historySaved: boolean;
  warning: string;
  // 実際に変更された項目だけが含まれる。locationはFieldLogEntryの命名に合わせてplaceとして返す
  entry: { memo?: string; foodName?: string; place?: string };
}

// フィールドログの更新（管理者限定）。memo/foodName/locationのうち、変更した項目だけをchangesに含めて呼ぶ。
// actorはクライアントから送らない（Worker側が認証結果から生成する）。
export async function updateFieldLogEntry(
  entryId: string,
  changes: FieldUpdateEntryChanges,
  idToken: string,
): Promise<FieldUpdateEntryResult> {
  let res: Response;
  try {
    res = await fetch(FIELD_UPDATE_ENTRY_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify({ entryId, changes }),
    });
  } catch {
    throw new Error('通信エラーが発生しました。もう一度お試しください。');
  }

  if (res.status === 401 || res.status === 403) {
    throw new TokenExpiredError('ログインの有効期限が切れました。入力内容はこの画面に残っています。再度ログインしてください。');
  }

  let json: Record<string, unknown>;
  try {
    json = await res.json();
  } catch {
    throw new Error('通信エラーが発生しました。もう一度お試しください。');
  }

  if (json.status !== 'success') {
    if (res.status === 404 || res.status === 409) {
      throw new Error('この記録は更新できませんでした。画面を開き直してください。');
    }
    if (res.status === 400 && typeof json.message === 'string') {
      throw new Error(json.message);
    }
    throw new Error('保存に失敗しました。もう一度お試しください。');
  }

  const rawEntry = (json.entry as Record<string, unknown> | undefined) ?? {};
  const entry: FieldUpdateEntryResult['entry'] = {};
  if (typeof rawEntry.memo === 'string') entry.memo = rawEntry.memo;
  if (typeof rawEntry.foodName === 'string') entry.foodName = rawEntry.foodName;
  if (typeof rawEntry.location === 'string') entry.place = rawEntry.location;

  return {
    entryId: typeof json.entryId === 'string' ? json.entryId : entryId,
    updatedFields: Array.isArray(json.updatedFields) ? (json.updatedFields as string[]) : [],
    noChange: json.noChange === true,
    sheetUpdated: json.sheetUpdated === true,
    notionSynced: json.notionSynced === true,
    historySaved: json.historySaved === true,
    warning: typeof json.warning === 'string' ? json.warning : '',
    entry,
  };
}
