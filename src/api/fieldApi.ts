import { FIELD_RECENT_URL, WORK_RECENT_URL } from '../config';
import type { FieldObservation, WorkLogItem, RecentApiSuccess, RecentApiError } from '../types/fieldLog';
import { TokenExpiredError, NetworkUnknownError } from './icarusApi';

async function fetchRecent<T>(baseUrl: string, idToken: string, limit: number): Promise<T[]> {
  let res: Response;
  try {
    res = await fetch(`${baseUrl}?limit=${limit}`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${idToken}` },
    });
  } catch {
    throw new NetworkUnknownError();
  }

  if (res.status === 401) {
    throw new TokenExpiredError('ログインセッションが切れました。再度ログインしてください。');
  }

  let json: RecentApiSuccess<T> | RecentApiError;
  try {
    json = (await res.json()) as RecentApiSuccess<T> | RecentApiError;
  } catch {
    throw new Error(`サーバーエラー (HTTP ${res.status})`);
  }

  if (json.status !== 'success') {
    throw new Error((json as RecentApiError).message || '取得に失敗しました');
  }

  return json.items;
}

export function fetchRecentFieldObservations(idToken: string, limit = 20): Promise<FieldObservation[]> {
  return fetchRecent<FieldObservation>(FIELD_RECENT_URL, idToken, limit);
}

export function fetchRecentWorkLogs(idToken: string, limit = 20): Promise<WorkLogItem[]> {
  return fetchRecent<WorkLogItem>(WORK_RECENT_URL, idToken, limit);
}
