import type { SubmissionEntity, SubmissionError } from './types';

export interface SubmissionAdapter<TPayload = unknown> {
  entity: SubmissionEntity;
  submit: (payload: TPayload, idToken: string) => Promise<unknown>;
  mapError: (err: unknown, ctx: { entity: SubmissionEntity; payloadId: string }) => SubmissionError;
}

const adapters = new Map<SubmissionEntity, SubmissionAdapter>();

export function registerAdapter<T>(adapter: SubmissionAdapter<T>): void {
  adapters.set(adapter.entity, adapter as SubmissionAdapter);
}

export function getAdapter(entity: SubmissionEntity): SubmissionAdapter {
  const adapter = adapters.get(entity);
  if (!adapter) throw new Error(`No submission adapter registered for entity: ${entity}`);
  return adapter;
}
