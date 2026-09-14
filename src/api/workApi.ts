import { WORK_SUBMIT_URL, WORK_DETAIL_URL, WORK_SEARCH_URL, workEntryVoidUrl, workEntryCorrectUrl } from '../config';
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

// Work Log Submission Framework: mapWorkLogErrorがretryable/non-retryableを実際のHTTP statusで
// 判定できるよう、statusを保持する。icarus-api（/work）は、Worker⇔GAS間の通信/応答不良
// （GAS fetch failed・GAS returned non-JSON等、既知のGAS Web App間欠的不安定性と同種）を502で、
// GAS自身が返した{status:'error'}（validation・workId不存在等、GASのロジックエラー）を500で
// 返す——この違いをメッセージ文字列のパターンマッチではなくstatusで区別する
export class WorkServerError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'WorkServerError';
    this.status = status;
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
    throw new WorkServerError(`非JSON応答 (HTTP ${res.status})`, res.status);
  }

  if (json.status !== 'success') {
    if (json.code === 'REQUEST_PROCESSING') {
      throw new WorkProcessingError(json.message);
    }
    throw new WorkServerError(json.message || '送信に失敗しました', res.status);
  }

  return json;
}

export interface WorkVoidSuccess {
  status: 'success';
  alreadyVoided: boolean;
}

// Work Log Void v1（admin限定）。sheetRowはWorkDetailEntry.sheetRow（void操作専用の内部キー、
// ユーザー向け表示には使わない）をそのまま渡す
export async function voidWorkEntry(workId: string, sheetRow: number, reason: string, idToken: string): Promise<WorkVoidSuccess> {
  let res: Response;
  try {
    res = await fetch(workEntryVoidUrl(workId, sheetRow), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify({ reason: reason || undefined }),
    });
  } catch {
    throw new NetworkUnknownError();
  }

  if (res.status === 401) {
    throw new TokenExpiredError('ログインセッションが切れました。再度ログインしてください。');
  }

  let json: WorkVoidSuccess | WorkSubmitError;
  try {
    json = (await res.json()) as WorkVoidSuccess | WorkSubmitError;
  } catch {
    throw new Error(`サーバーエラー (HTTP ${res.status})`);
  }

  if (json.status !== 'success') {
    throw new Error(json.message || '無効化に失敗しました');
  }

  return json;
}

export interface WorkCorrectSuccess {
  status: 'success';
  // 通信断でレスポンスが失われた場合の再送を、サーバー側がこのフラグで安全に吸収する
  // （2026-09-14 Correction Final Design修正）。クライアント側で特別な再送ロジックは持たない
  alreadyCorrected?: boolean;
  content: string;
  caption: string;
}

interface WorkCorrectError {
  status: 'error';
  message: string;
  code?: 'NOT_FOUND' | 'CORRECTION_CONFLICT' | 'ENTRY_VOIDED';
  currentContent?: string;
  currentCaption?: string;
}

// 同時編集での楽観的排他制御の衝突（409 CORRECTION_CONFLICT）専用のエラー型。
// サーバーが返したライブのSheets値（currentContent/currentCaption）を保持し、
// 呼び出し側がその場でフォームへ取り込んで再編集できるようにする
export class WorkCorrectionConflictError extends Error {
  currentContent: string;
  currentCaption: string;
  constructor(message: string, currentContent: string, currentCaption: string) {
    super(message);
    this.name = 'WorkCorrectionConflictError';
    this.currentContent = currentContent;
    this.currentCaption = currentCaption;
  }
}

// Work Log Correction v1（admin限定）。sheetRowはWorkDetailEntry.sheetRow（訂正操作専用の内部キー、
// void同様ユーザー向け表示には使わない）をそのまま渡す。expectedContent/expectedCaptionは
// 楽観的排他制御用——呼び出し側は画面に表示中の現在値をそのまま渡す
export async function correctWorkEntry(
  workId: string, sheetRow: number,
  content: string, caption: string,
  expectedContent: string, expectedCaption: string,
  note: string, idToken: string,
): Promise<WorkCorrectSuccess> {
  let res: Response;
  try {
    res = await fetch(workEntryCorrectUrl(workId, sheetRow), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify({ content, caption, expectedContent, expectedCaption, note: note || undefined }),
    });
  } catch {
    throw new NetworkUnknownError();
  }

  if (res.status === 401) {
    throw new TokenExpiredError('ログインセッションが切れました。再度ログインしてください。');
  }

  let json: WorkCorrectSuccess | WorkCorrectError;
  try {
    json = await res.json();
  } catch {
    throw new Error(`サーバーエラー (HTTP ${res.status})`);
  }

  if (json.status !== 'success') {
    if (json.code === 'CORRECTION_CONFLICT') {
      throw new WorkCorrectionConflictError(
        json.message || '他の変更と競合しました。最新の内容を確認してください。',
        json.currentContent ?? '',
        json.currentCaption ?? '',
      );
    }
    throw new Error(json.message || '訂正に失敗しました');
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
