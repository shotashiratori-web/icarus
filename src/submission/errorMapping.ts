import { TokenExpiredError } from '../api/icarusApi';
import { PhotoUploadFailedError } from '../api/fieldLogD1Api';
import { NetworkUnknownError, WorkProcessingError } from '../api/workApi';
import type { ErrorCode, SubmissionEntity, SubmissionError } from './types';

const TITLES: Record<ErrorCode, string> = {
  HEADER_MISMATCH: 'アプリの更新が必要です',
  AUTH_EXPIRED: 'ログインが必要です',
  NETWORK_ERROR: '通信エラー',
  SERVER_ERROR: 'サーバーエラー',
  UPLOAD_FAILED: '写真のアップロードに失敗しました',
  IMAGE_PARSE_FAILED: '画像の読み込みに失敗しました',
  GPS_NOT_FOUND: '位置情報を取得できませんでした',
  UNSUPPORTED_MEDIA_TYPE: '対応していない写真形式です',
};

// Unit D（Cloudinary直接アップロード段階）専用の説明文。D1保存段階の失敗とは区別して伝える
const UPLOAD_FAILED_DESCRIPTION =
  'Cloudinaryへの画像アップロードに失敗しました。入力内容は保持されています。あとから再試行できます（再試行時は保存済みの写真を再アップロードしません）。';

// Stage 1A: ASSET_UNSUPPORTED_MIME_TYPE専用の利用者向け文言。HEIC/MIME等の技術語は出さない。
// FoodLogScreen側の選択直後チェック（UX改善、API側validationの代わりではない）とも文言を揃えるためexportする
export const UNSUPPORTED_MEDIA_TYPE_DESCRIPTION =
  '現在この写真形式には対応していません。JPEG形式の写真を選択してください。';

const DESCRIPTION = '通信またはサーバーの都合で送信できませんでした。データは保存されています。あとから再送できます。';

function buildError(
  code: ErrorCode,
  ctx: { entity: SubmissionEntity; payloadId: string },
  retryable: boolean,
  technicalDetail?: string,
  description: string = DESCRIPTION,
): SubmissionError {
  return {
    code,
    title: TITLES[code],
    description,
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

// Unit D（Worker+D1新経路）専用。Cloudinaryアップロード段階の失敗をD1保存段階の失敗と区別して伝える
export function mapFieldLogD1Error(
  err: unknown,
  ctx: { entity: SubmissionEntity; payloadId: string },
): SubmissionError {
  if (err instanceof TokenExpiredError) {
    return buildError('AUTH_EXPIRED', ctx, true, err.message);
  }
  if (err instanceof PhotoUploadFailedError) {
    // Stage 1A: MIME不一致（HEIC/HEIF等）はファイル形式に起因する恒久的失敗。再送しても
    // 結果は変わらないためretryable:falseで区別する。それ以外（通信断・R2一時障害・5xx等）は
    // 従来通りretryable:trueのUPLOAD_FAILEDのまま
    if (err.code === 'ASSET_UNSUPPORTED_MIME_TYPE') {
      return buildError('UNSUPPORTED_MEDIA_TYPE', ctx, false, err.message, UNSUPPORTED_MEDIA_TYPE_DESCRIPTION);
    }
    return buildError('UPLOAD_FAILED', ctx, true, err.message, UPLOAD_FAILED_DESCRIPTION);
  }
  if (err instanceof Error) {
    return buildError('NETWORK_ERROR', ctx, true, err.message);
  }
  return buildError('SERVER_ERROR', ctx, true, String(err));
}

const WORK_LOG_PROCESSING_DESCRIPTION = '処理中です。しばらくすると自動で再送されます。';
const WORK_LOG_VALIDATION_DESCRIPTION = '内容を確認してから再送してください。自動では再送されません。';

// Work Log Submission Framework Final Design ①。GAS側（handleIcarusWorkRequest_）は
// REQUEST_PROCESSING以外のエラーをすべて{status:'error', message}という同一shapeで返し、
// codeを持たない——つまり「workId不存在」も「Sheetsの一時的な書き込み失敗」もクライアントからは
// 区別できない。GASの変更・pushは禁止のためcode付与では解決できない。
// そのため、確実に判別できる範囲（通信断・応答不正・処理中・認証切れ）だけをretryable:trueとし、
// それ以外（GASが明示的にロジックエラーとして返した汎用message）はデフォルトでretryable:falseとする
// （「retryしても直らない前提」を安全側に倒す。誤ってretryable:falseにしても、resendAll()の一括対象から
// 外れるだけでPending Listからの個別「再送」までは禁止されないため、ユーザーは詰まない）
export function mapWorkLogError(
  err: unknown,
  ctx: { entity: SubmissionEntity; payloadId: string },
): SubmissionError {
  if (err instanceof TokenExpiredError) {
    return buildError('AUTH_EXPIRED', ctx, true, err.message);
  }
  if (err instanceof NetworkUnknownError) {
    return buildError('NETWORK_ERROR', ctx, true, err.message);
  }
  if (err instanceof WorkProcessingError) {
    return buildError('SERVER_ERROR', ctx, true, err.message, WORK_LOG_PROCESSING_DESCRIPTION);
  }
  // res.json()失敗・非JSON応答等、GAS Web App自体が不安定な場合（既知のGAS Web App間欠的不安定性と同種）
  if (err instanceof Error && /^サーバーエラー \(HTTP/.test(err.message)) {
    return buildError('SERVER_ERROR', ctx, true, err.message);
  }
  if (err instanceof Error) {
    return buildError('SERVER_ERROR', ctx, false, err.message, WORK_LOG_VALIDATION_DESCRIPTION);
  }
  return buildError('SERVER_ERROR', ctx, false, String(err));
}
