import { TokenExpiredError } from '../api/icarusApi';
import type { ErrorCode, SubmissionEntity, SubmissionError } from './types';

const TITLES: Record<ErrorCode, string> = {
  HEADER_MISMATCH: 'アプリの更新が必要です',
  AUTH_EXPIRED: 'ログインが必要です',
  NETWORK_ERROR: '通信エラー',
  SERVER_ERROR: 'サーバーエラー',
  UPLOAD_FAILED: 'アップロード失敗',
  IMAGE_PARSE_FAILED: '画像の読み込みに失敗しました',
  GPS_NOT_FOUND: '位置情報を取得できませんでした',
};

const DESCRIPTION = '通信またはサーバーの都合で送信できませんでした。データは保存されています。あとから再送できます。';

function buildError(
  code: ErrorCode,
  ctx: { entity: SubmissionEntity; payloadId: string },
  retryable: boolean,
  technicalDetail?: string,
): SubmissionError {
  return {
    code,
    title: TITLES[code],
    description: DESCRIPTION,
    retryable,
    technicalDetail,
    timestamp: new Date().toISOString(),
    entity: ctx.entity,
    payloadId: ctx.payloadId,
  };
}

// icarusApi.ts(及び今後の各entity adapter)が投げる例外を共通のエラーモデルへ正規化する。
// Phase1では「利用者へerrorを極力見せない」方針のため、ここで分類する内容はほぼ全てretryable:trueの保留として扱われる。
export function mapIcarusApiError(
  err: unknown,
  ctx: { entity: SubmissionEntity; payloadId: string },
): SubmissionError {
  if (err instanceof TokenExpiredError) {
    return buildError('AUTH_EXPIRED', ctx, true, err.message);
  }
  if (err instanceof Error) {
    return buildError('NETWORK_ERROR', ctx, true, err.message);
  }
  return buildError('SERVER_ERROR', ctx, true, String(err));
}

export function authExpiredError(ctx: { entity: SubmissionEntity; payloadId: string }): SubmissionError {
  return buildError('AUTH_EXPIRED', ctx, true, 'idToken not available');
}
