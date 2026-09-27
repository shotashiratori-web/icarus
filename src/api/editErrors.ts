import { TokenExpiredError } from './icarusApi';

// 編集 API の共通エラー表現（共通化 Audit §1、2026-09-27）。
// 401 はログインし直し（既存の TokenExpiredError を使い、画面の handleTokenExpired につなぐ）、
// 403 は権限なし、404 は見つからない、409 は他の人が先に更新した。文言の既定値はここで決め、
// ドメイン固有の文言（例: 「無効化済みの記録は訂正できません」）はサーバーの message を優先して表示する。
// Field の既存 API クライアント（fieldEntryEditApi.ts）はこのファイルを使わない

export class EditConflictError<TCurrent = unknown> extends Error {
  // 409 の応答に最新値が含まれる API（Work Log の Correction など）は、ここに入れて画面へ渡す
  readonly current?: TCurrent;
  readonly code?: string;
  constructor(message: string, opts: { current?: TCurrent; code?: string } = {}) {
    super(message);
    this.name = 'EditConflictError';
    this.current = opts.current;
    this.code = opts.code;
  }
}

export class EditForbiddenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EditForbiddenError';
  }
}

export class EditNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EditNotFoundError';
  }
}

export const EDIT_ERROR_MESSAGES = {
  unauthorized: 'ログインの有効期限が切れました。入力内容はこの画面に残っています。再度ログインしてください。',
  forbidden: 'この操作をする権限がありません。',
  notFound: '記録が見つかりません。削除された可能性があります。',
  conflict: '他の人が先にこの記録を更新しました。',
  network: '通信エラーが発生しました。もう一度お試しください。',
  unknown: '保存に失敗しました。もう一度お試しください。',
} as const;

// HTTP の応答をエラーへ変換する。成功（2xx かつ status!=='error'）なら何もしない。
// 409 で最新値を返す API は current に渡す値を pickCurrent で取り出す
export function throwIfEditError<TCurrent = unknown>(
  httpStatus: number,
  json: Record<string, unknown>,
  pickCurrent?: (json: Record<string, unknown>) => TCurrent | undefined,
): void {
  const serverMessage = typeof json.message === 'string' && json.message ? json.message : '';
  const code = typeof json.code === 'string' ? json.code : undefined;
  if (httpStatus === 401) throw new TokenExpiredError(EDIT_ERROR_MESSAGES.unauthorized);
  if (httpStatus === 403) throw new EditForbiddenError(serverMessage || EDIT_ERROR_MESSAGES.forbidden);
  if (httpStatus === 404) throw new EditNotFoundError(serverMessage || EDIT_ERROR_MESSAGES.notFound);
  if (httpStatus === 409) {
    throw new EditConflictError<TCurrent>(serverMessage || EDIT_ERROR_MESSAGES.conflict, { current: pickCurrent?.(json), code });
  }
  if (httpStatus >= 400 || json.status === 'error') throw new Error(serverMessage || EDIT_ERROR_MESSAGES.unknown);
}

// 画面に出す文言。TokenExpiredError は呼び出し側で handleTokenExpired() も行う
export function editErrorMessage(e: unknown, fallback: string = EDIT_ERROR_MESSAGES.unknown): string {
  if (e instanceof Error && e.message) return e.message;
  return fallback;
}
