import { registerAdapter } from '../registry';
import type { SubmissionError } from '../types';

// Exploration History（Stage 2）: 送信の予約だけを Submission Framework に載せる（キューには ID だけ、GPX 原本は入れない）。
// 正本は端末の icarus-exploration（段階つき）。ここは「今送れるところまで進める」を呼ぶだけ。
// 送信の仕組み（sync）は遅延読み込み（通常画面の初回 JS を増やさない）ため、エラーは name で見分ける
export interface ExplorationSubmissionPayload {
  pendingId: string;
}

function err(code: SubmissionError['code'], title: string, description: string, retryable: boolean, ctx: { entity: SubmissionError['entity']; payloadId: string }, technicalDetail?: string): SubmissionError {
  return { code, title, description, retryable, technicalDetail, timestamp: new Date().toISOString(), entity: ctx.entity, payloadId: ctx.payloadId };
}

registerAdapter<ExplorationSubmissionPayload, unknown>({
  entity: 'explorationSession',
  submit: async (payload, idToken) => (await import('../../exploration/sync')).syncPending(payload.pendingId, idToken),
  mapError: (e, ctx) => {
    const name = e instanceof Error ? e.name : '';
    const message = e instanceof Error ? e.message : String(e);
    if (name === 'TokenExpiredError') return err('AUTH_EXPIRED', 'ログインが必要です', 'ログインすると自動で送信します。GPX は端末に保存されています。', true, ctx, message);
    if (name === 'ExplorationNetworkError') return err('NETWORK_ERROR', '通信エラー', '電波のある所で自動的に送信します。GPX は端末に保存されています。', true, ctx);
    if (name === 'ExplorationRejectedError') return err('GPX_REJECTED', 'GPX を登録できませんでした', message, false, ctx, (e as { code?: string }).code);
    if (name === 'ExplorationApiError') {
      const status = (e as { status?: number }).status ?? 0;
      return status >= 500 || status === 429
        ? err('SERVER_ERROR', 'サーバーエラー', 'サーバーの都合で送信できませんでした。GPX は端末に保存されています。', true, ctx, `${status}`)
        : err('GPX_REJECTED', 'GPX を登録できませんでした', message, false, ctx, `${status}`);
    }
    return err('SERVER_ERROR', '送信できませんでした', 'GPX は端末に保存されています。あとで再送できます。', true, ctx, message);
  },
});
