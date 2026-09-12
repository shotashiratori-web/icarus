import type { SubmissionEntity, SubmissionError } from './types';

// R: adapter成功時の戻り値の型。デフォルトはvoid（既存adapterの大半は呼び出し元へ結果を返す必要が無い）。
// Work Logのように成功直後にレスポンス内容（workId等）が必要なentityだけRを指定する
export interface SubmissionAdapter<TPayload = unknown, R = void> {
  entity: SubmissionEntity;
  submit: (payload: TPayload, idToken: string) => Promise<R>;
  mapError: (err: unknown, ctx: { entity: SubmissionEntity; payloadId: string }) => SubmissionError;
}

const adapters = new Map<SubmissionEntity, SubmissionAdapter>();

export function registerAdapter<T, R = void>(adapter: SubmissionAdapter<T, R>): void {
  adapters.set(adapter.entity, adapter as SubmissionAdapter);
}

export function getAdapter(entity: SubmissionEntity): SubmissionAdapter {
  const adapter = adapters.get(entity);
  if (!adapter) throw new Error(`No submission adapter registered for entity: ${entity}`);
  return adapter;
}
