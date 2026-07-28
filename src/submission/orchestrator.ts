import { getAdapter } from './registry';
import { useSubmissionQueue } from './queueStore';
import { authExpiredError } from './errorMapping';
import * as queueDB from './queueDB';
import type { SubmissionEntity, SubmissionItem } from './types';

type SubmitParams<T> = {
  entity: SubmissionEntity;
  itemId: string;
  payload: T;
  title: string;
  photoThumbnail?: string;
  displayDate?: string;
  idToken: string | null;
};

// 一度だけ送信を試み、失敗したらqueueへ保留として永続化する。呼び出し元はneverthrow — 失敗はqueueへの格納として表現される。
export async function submitWithFallback<T>(
  params: SubmitParams<T>,
): Promise<{ ok: true } | { ok: false; item: SubmissionItem<T> }> {
  const { entity, itemId, payload, title, photoThumbnail, displayDate, idToken } = params;
  const now = new Date().toISOString();

  const existing = await queueDB.get(itemId);
  const attempts = (existing?.attempts ?? 0) + 1;

  if (!idToken) {
    const item: SubmissionItem<T> = {
      id: itemId,
      entity,
      state: 'pending',
      payload,
      title,
      photoThumbnail,
      displayDate,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      attempts,
      lastError: authExpiredError({ entity, payloadId: itemId }),
    };
    await useSubmissionQueue.getState().upsert(item);
    return { ok: false, item };
  }

  const adapter = getAdapter(entity);
  try {
    await adapter.submit(payload, idToken);
    if (existing) await useSubmissionQueue.getState().remove(itemId);
    return { ok: true };
  } catch (err) {
    const item: SubmissionItem<T> = {
      id: itemId,
      entity,
      state: 'pending',
      payload,
      title,
      photoThumbnail,
      displayDate,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      attempts,
      lastError: adapter.mapError(err, { entity, payloadId: itemId }),
    };
    await useSubmissionQueue.getState().upsert(item);
    return { ok: false, item };
  }
}

export async function resendItem(
  id: string,
  idToken: string | null,
): Promise<{ ok: true } | { ok: false; item: SubmissionItem }> {
  const item = await queueDB.get(id);
  if (!item) return { ok: true }; // 既に削除/再送済み
  return submitWithFallback({
    entity: item.entity,
    itemId: item.id,
    payload: item.payload,
    title: item.title,
    photoThumbnail: item.photoThumbnail,
    displayDate: item.displayDate,
    idToken,
  });
}

// GASバックエンドへの負荷を抑えるため、既存の食材ログ送信ループと同様に逐次実行する。
export async function resendAll(idToken: string | null): Promise<{ succeeded: number; stillPending: number }> {
  const items = await queueDB.listAll();
  let succeeded = 0;
  let stillPending = 0;
  for (const item of items) {
    const result = await resendItem(item.id, idToken);
    if (result.ok) succeeded++;
    else stillPending++;
  }
  return { succeeded, stillPending };
}
