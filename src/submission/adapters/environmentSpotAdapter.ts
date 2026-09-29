import { registerAdapter } from '../registry';
import type { SubmissionError } from '../types';

// Environment Spots（S3）: 送信の予約だけを Submission Framework に載せる（キューには ID だけ、写真の原本は入れない）。
// 正本は端末の icarus-environment-spots（段階つき）。送信の仕組みは遅延読み込みのため、エラーは name で見分ける
export interface SpotSubmissionPayload {
  pendingId: string;
}

function err(code: SubmissionError['code'], title: string, description: string, retryable: boolean, ctx: { entity: SubmissionError['entity']; payloadId: string }, technicalDetail?: string): SubmissionError {
  return { code, title, description, retryable, technicalDetail, timestamp: new Date().toISOString(), entity: ctx.entity, payloadId: ctx.payloadId };
}

function mapError(e: unknown, ctx: { entity: SubmissionError['entity']; payloadId: string }): SubmissionError {
  const name = e instanceof Error ? e.name : '';
  const message = e instanceof Error ? e.message : String(e);
  const kept = '記録と写真は端末に保存されています。';
  if (name === 'TokenExpiredError') return err('AUTH_EXPIRED', 'ログインが必要です', `ログインすると自動で送信します。${kept}`, true, ctx, message);
  if (name === 'SpotNetworkError') return err('NETWORK_ERROR', '通信エラー', `電波のある所で自動的に送信します。${kept}`, true, ctx);
  if (name === 'SpotRejectedError') return err('SERVER_ERROR', '登録できませんでした', `${message}（${kept}）`, false, ctx, (e as { code?: string }).code);
  if (name === 'SpotApiError') {
    const status = (e as { status?: number }).status ?? 0;
    return status >= 500 || status === 429
      ? err('SERVER_ERROR', 'サーバーエラー', `サーバーの都合で送信できませんでした。${kept}`, true, ctx, `${status}`)
      : err('SERVER_ERROR', '登録できませんでした', message, false, ctx, `${status}`);
  }
  return err('SERVER_ERROR', '送信できませんでした', `${kept}あとで再送できます。`, true, ctx, message);
}

registerAdapter<SpotSubmissionPayload, unknown>({
  entity: 'environmentSpot',
  submit: async (payload, idToken) => (await import('../../environmentSpots/sync')).syncSpot(payload.pendingId, idToken),
  mapError,
});

registerAdapter<SpotSubmissionPayload, unknown>({
  entity: 'spotObservation',
  submit: async (payload, idToken) => (await import('../../environmentSpots/sync')).syncObservation(payload.pendingId, idToken),
  mapError,
});
