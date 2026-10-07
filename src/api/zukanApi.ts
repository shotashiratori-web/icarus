import { FIELD_MAP_GEOJSON_URL, FIELD_CLASSIFY_PHOTO_URL } from '../config';
import { buildFieldLogId, type FieldLogEntry, type FieldLogGeoJson } from '../types/zukan';
import { TokenExpiredError } from './icarusApi';

export class NetworkUnknownError extends Error {
  constructor() {
    super('ネットワークエラーが発生しました。通信状況を確認してください。');
    this.name = 'NetworkUnknownError';
  }
}

// Field Map D1 Read Path Stage 1（icarus_field_map_d1_read_path_final_design.md）。
// 旧GAS `?action=field_logs_geojson`（Sheets直読み、認証不要）から、Worker `/field/map-geojson`
// （D1直読み、要認証）へ切り替える。レスポンスのGeoJSON形状は旧契約を再現しているため、
// 呼び出し側のパース処理自体は変更しない
export async function fetchFieldLogEntries(idToken: string): Promise<FieldLogEntry[]> {
  let res: Response;
  try {
    res = await fetch(FIELD_MAP_GEOJSON_URL, {
      method: 'GET',
      headers: { Authorization: `Bearer ${idToken}` },
    });
  } catch {
    throw new NetworkUnknownError();
  }

  if (res.status === 401) {
    throw new TokenExpiredError('ログインセッションが切れました。再度ログインしてください。');
  }

  let json: FieldLogGeoJson;
  try {
    json = await res.json();
  } catch {
    throw new Error(`サーバーエラー (HTTP ${res.status})`);
  }

  return json.features.map((f) => {
    const [lng, lat] = f.geometry.coordinates;
    const { foodName, place, date, memo, photoUrl, thumbnailUrl, notionUrl, elevation, kigo, recordedAt, eventId, takenAt, largeCategory, subCategory, subjectType, assetId, environmentSpotId } = f.properties;
    return {
      id: buildFieldLogId(date, lat, lng, recordedAt),
      foodName, place, date, memo, photoUrl, notionUrl, elevation, kigo, lat, lng,
      thumbnailUrl: thumbnailUrl || '',
      recordedAt: recordedAt || '',
      eventId: eventId || '',
      takenAt: takenAt || '',
      ...(largeCategory ? { largeCategory } : {}),
      ...(subCategory ? { subCategory } : {}),
      ...(subjectType ? { subjectType } : {}),
      ...(assetId ? { assetId } : {}),
      ...(environmentSpotId ? { environmentSpotId } : {}),
    };
  });
}

export interface ClassifyFieldPhotoResult {
  isFieldSubject: boolean;
  reason: string;
}

// 一括写真整理のAI一次判定（管理者限定）。「食材写真かどうか」だけを判定し、種の同定はしない。
// あくまで参考表示であり、無効化は管理者が人の判断で行う（icarus_field_log_void_design.md）。
export async function classifyFieldPhoto(photoUrl: string, idToken: string): Promise<ClassifyFieldPhotoResult> {
  let res: Response;
  try {
    res = await fetch(FIELD_CLASSIFY_PHOTO_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify({ photoUrl }),
    });
  } catch {
    throw new Error('通信エラーが発生しました。もう一度お試しください。');
  }

  if (res.status === 401 || res.status === 403) {
    throw new TokenExpiredError('ログインの有効期限が切れました。再度ログインしてください。');
  }

  let json: Record<string, unknown>;
  try {
    json = await res.json();
  } catch {
    throw new Error('AI判定に失敗しました。もう一度お試しください。');
  }

  if (json.status !== 'success' || typeof json.isFieldSubject !== 'boolean') {
    throw new Error(typeof json.message === 'string' ? json.message : 'AI判定に失敗しました。');
  }

  return {
    isFieldSubject: json.isFieldSubject,
    reason: typeof json.reason === 'string' ? json.reason : '',
  };
}
