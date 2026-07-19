import {
  STAFF_ME_URL, STAFF_ROSTER_URL, STAFF_APPROVE_URL, STAFF_UPDATE_URL,
  STAFF_ROLE_URL, STAFF_SUSPEND_URL, STAFF_REACTIVATE_URL,
} from '../config';
import type {
  StaffMe, StaffMeSuccess, StaffMeError,
  StaffRosterItem, StaffRosterSuccess,
  StaffApproveePayload, StaffUpdatePayload, StaffRolePayload, StaffEmailPayload,
  StaffActionSuccess, StaffAdminError,
} from '../types/staff';
import { TokenExpiredError } from './icarusApi';
import { NetworkUnknownError } from './workApi';

export class ForbiddenRoleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ForbiddenRoleError';
  }
}

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

async function adminGet<T>(url: string, idToken: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { method: 'GET', headers: { Authorization: `Bearer ${idToken}` } });
  } catch {
    throw new NetworkUnknownError();
  }
  if (res.status === 401) {
    throw new TokenExpiredError('ログインセッションが切れました。再度ログインしてください。');
  }
  let json: (T & { status: 'success' }) | StaffAdminError;
  try {
    json = await res.json();
  } catch {
    throw new Error(`サーバーエラー (HTTP ${res.status})`);
  }
  if (json.status !== 'success') {
    if (json.code === 'FORBIDDEN_ROLE') throw new ForbiddenRoleError(json.message);
    throw new Error(json.message || '取得に失敗しました');
  }
  return json;
}

async function adminPost(url: string, idToken: string, payload: unknown): Promise<void> {
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
  let json: StaffActionSuccess | StaffAdminError;
  try {
    json = await res.json();
  } catch {
    throw new Error(`サーバーエラー (HTTP ${res.status})`);
  }
  if (json.status !== 'success') {
    if (json.code === 'FORBIDDEN_ROLE') throw new ForbiddenRoleError(json.message);
    throw new Error(json.message || '操作に失敗しました');
  }
}

export async function fetchStaffRoster(idToken: string): Promise<StaffRosterItem[]> {
  const json = await adminGet<StaffRosterSuccess>(STAFF_ROSTER_URL, idToken);
  return json.items;
}

export async function approveStaff(payload: StaffApproveePayload, idToken: string): Promise<void> {
  return adminPost(STAFF_APPROVE_URL, idToken, payload);
}

export async function updateStaff(payload: StaffUpdatePayload, idToken: string): Promise<void> {
  return adminPost(STAFF_UPDATE_URL, idToken, payload);
}

export async function changeRole(payload: StaffRolePayload, idToken: string): Promise<void> {
  return adminPost(STAFF_ROLE_URL, idToken, payload);
}

export async function suspendStaff(payload: StaffEmailPayload, idToken: string): Promise<void> {
  return adminPost(STAFF_SUSPEND_URL, idToken, payload);
}

export async function reactivateStaff(payload: StaffEmailPayload, idToken: string): Promise<void> {
  return adminPost(STAFF_REACTIVATE_URL, idToken, payload);
}
