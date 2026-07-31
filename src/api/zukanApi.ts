import { FIELD_LOGS_GEOJSON_URL, FIELD_DELETE_ENTRIES_URL } from '../config';
import { buildFieldLogId, type FieldLogEntry, type FieldLogGeoJson } from '../types/zukan';

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
