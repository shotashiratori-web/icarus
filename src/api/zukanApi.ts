import { FIELD_LOGS_GEOJSON_URL } from '../config';
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
    const { foodName, place, date, memo, photoUrl, notionUrl, elevation, kigo } = f.properties;
    return {
      id: buildFieldLogId(date, lat, lng),
      foodName, place, date, memo, photoUrl, notionUrl, elevation, kigo, lat, lng,
    };
  });
}
