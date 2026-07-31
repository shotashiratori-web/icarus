import { WORK_SUBMIT_URL, WORK_DETAIL_URL, WORK_SEARCH_URL } from '../config';
import type {
  WorkDetail, WorkDetailSuccess, WorkSubmitPayload, WorkSubmitSuccess, WorkSubmitError,
  WorkSearchParams, WorkSearchSuccess,
} from '../types/workLog';
import { TokenExpiredError } from './icarusApi';

export class NetworkUnknownError extends Error {
  constructor() {
    super('ネットワークエラーが発生しました。通信状況を確認してください。');
    this.name = 'NetworkUnknownError';
  }
}

export class WorkProcessingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WorkProcessingError';
  }
}

export class WorkNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WorkNotFoundError';
  }
}

export async function submitWork(payload: WorkSubmitPayload, idToken: string): Promise<WorkSubmitSuccess> {
  let res: Response;
  try {
    res = await fetch(WORK_SUBMIT_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify(payload),
    });
  } catch {
    throw new NetworkUnknownError();
  }

  if (res.status === 401) {
    throw new TokenExpiredError('ログインセッションが切れました。再度ログインしてください。');
  }

  let json: WorkSubmitSuccess | WorkSubmitError;
  try {
    json = (await res.json()) as WorkSubmitSuccess | WorkSubmitError;
  } catch {
    throw new Error(`サーバーエラー (HTTP ${res.status})`);
  }

  if (json.status !== 'success') {
    if (json.code === 'REQUEST_PROCESSING') {
      throw new WorkProcessingError(json.message);
    }
    throw new Error(json.message || '送信に失敗しました');
  }

  return json;
}

export async function fetchWorkDetail(workId: string, idToken: string): Promise<WorkDetail> {
  let res: Response;
  try {
    res = await fetch(`${WORK_DETAIL_URL}?workId=${encodeURIComponent(workId)}`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${idToken}` },
    });
  } catch {
    throw new NetworkUnknownError();
  }

  if (res.status === 401) {
    throw new TokenExpiredError('ログインセッションが切れました。再度ログインしてください。');
  }

  let json: WorkDetailSuccess | WorkSubmitError;
  try {
    json = await res.json();
  } catch {
    throw new Error(`サーバーエラー (HTTP ${res.status})`);
  }

  if (res.status === 404 || json.status !== 'success') {
    const message = (json as WorkSubmitError).message || '取得に失敗しました';
    if (res.status === 404 || (json as WorkSubmitError).code === 'NOT_FOUND') {
      throw new WorkNotFoundError(message);
    }
    throw new Error(message);
  }

  return json.item;
}

// /work/search（Phase 1 第2段階）。検索・絞り込み・ページネーションはUnit D/Eで使うが、
// Unit Cではlimit/offsetのみ指定し、検索ボックス等はまだ接続しない
export async function searchWorkLogs(params: WorkSearchParams, idToken: string): Promise<WorkSearchSuccess> {
  const qs = new URLSearchParams();
  if (params.query) qs.set('query', params.query);
  if (params.dateStart) qs.set('dateStart', params.dateStart);
  if (params.dateEnd) qs.set('dateEnd', params.dateEnd);
  if (params.hasPhoto !== undefined) qs.set('hasPhoto', String(params.hasPhoto));
  if (params.limit !== undefined) qs.set('limit', String(params.limit));
  if (params.offset !== undefined) qs.set('offset', String(params.offset));

  let res: Response;
  try {
    res = await fetch(`${WORK_SEARCH_URL}?${qs.toString()}`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${idToken}` },
    });
  } catch {
    throw new NetworkUnknownError();
  }

  if (res.status === 401) {
    throw new TokenExpiredError('ログインセッションが切れました。再度ログインしてください。');
  }

  let json: WorkSearchSuccess | WorkSubmitError;
  try {
    json = await res.json();
  } catch {
    throw new Error(`サーバーエラー (HTTP ${res.status})`);
  }

  if (json.status !== 'success') {
    throw new Error((json as WorkSubmitError).message || '取得に失敗しました');
  }

  return json;
}
