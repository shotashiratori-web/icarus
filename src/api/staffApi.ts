import { STAFF_ME_URL } from '../config';
import type { StaffMe, StaffMeSuccess, StaffMeError } from '../types/staff';
import { TokenExpiredError } from './icarusApi';
import { NetworkUnknownError } from './workApi';

export async function fetchMyStaffStatus(idToken: string): Promise<StaffMe> {
  let res: Response;
  try {
    res = await fetch(STAFF_ME_URL, {
      method: 'GET',
      headers: { Authorization: `Bearer ${idToken}` },
    });
  } catch {
    throw new NetworkUnknownError();
  }

  if (res.status === 401) {
    throw new TokenExpiredError('ログインセッションが切れました。再度ログインしてください。');
  }

  let json: StaffMeSuccess | StaffMeError;
  try {
    json = await res.json();
  } catch {
    throw new Error(`サーバーエラー (HTTP ${res.status})`);
  }

  if (json.status !== 'success') {
    throw new Error(json.message || '取得に失敗しました');
  }

  return json.item;
}
