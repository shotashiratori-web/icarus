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
// R: adapter成功時の戻り値。既存呼び出し元は無視すればよいだけなのでbehavior変更は無い（デフォルトunknown）。
// Work Logのように送信直後のレスポンス内容（workId等）が必要な場合のみ型引数で指定する
export async function submitWithFallback<T, R = unknown>(
  params: SubmitParams<T>,
): Promise<{ ok: true; result: R } | { ok: false; item: SubmissionItem<T> }> {
  const { entity, itemId, payload, title, photoThumbnail, displayDate, idToken } = params;
  const now = new Date().toISOString();

  // IndexedDBが開けない(他タブによるブロック等)場合でも、既存件は「無し」扱いで処理を続ける。
  // ここで例外を投げると呼び出し元(startSend等)がUIを進められなくなるため、必ずどちらかの結果を返す。
  const existing = await queueDB.get(itemId).catch(() => undefined);
  const attempts = (existing?.attempts ?? 0) + 1;

  // queueへの永続化に失敗しても(表示中の)itemはそのまま返す。次のIndexedDB操作で再度永続化を試みる。
  const persistUpsert = (item: SubmissionItem<T>) => useSubmissionQueue.getState().upsert(item).catch(() => {});
  const persistRemove = (id: string) => useSubmissionQueue.getState().remove(id).catch(() => {});

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
    await persistUpsert(item);
    return { ok: false, item };
  }

  const adapter = getAdapter(entity);
  try {
    const result = (await adapter.submit(payload, idToken)) as R;
    if (existing) await persistRemove(itemId);
    return { ok: true, result };
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
    await persistUpsert(item);
    return { ok: false, item };
  }
}

export async function resendItem(
  id: string,
  idToken: string | null,
): Promise<{ ok: true; result: unknown } | { ok: false; item: SubmissionItem }> {
  const item = await queueDB.get(id);
  if (!item) return { ok: true, result: undefined }; // 既に削除/再送済み
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

type ResendAllResult = { succeeded: number; stillPending: number };

// App起動時／online復帰時／手動「すべて再送」がほぼ同時に発火しても、実際の処理は1回だけ走る
// ようにするための相乗りguard（Wine Tasting Noteのinflight Setと同種の事故を、resendAll単位で
// フレームワーク側に1箇所だけ実装する）。完了後（resolve/reject問わず）は必ずnullへ戻し、
// 次回呼び出しでは新しい実行が始まる
let resendAllInFlight: Promise<ResendAllResult> | null = null;

export function resendAll(idToken: string | null): Promise<ResendAllResult> {
  if (resendAllInFlight) return resendAllInFlight;
  resendAllInFlight = doResendAll(idToken).finally(() => {
    resendAllInFlight = null;
  });
  return resendAllInFlight;
}

// GASバックエンドへの負荷を抑えるため、既存の食材ログ送信ループと同様に逐次実行する。
async function doResendAll(idToken: string | null): Promise<ResendAllResult> {
  const items = await queueDB.listAll();
  let succeeded = 0;
  let stillPending = 0;
  for (const item of items) {
    // retryable:false（例: ASSET_UNSUPPORTED_MIME_TYPE）は再送しても結果が変わらない恒久的失敗のため、
    // 「すべて再送」の対象からは除外する（無意味なAPI呼び出し・queueの無駄な再送ループを防ぐ）。
    // 保留一覧からは消えない＝データは失われない。個別の「再送」操作までは禁止しない
    if (item.lastError?.retryable === false) {
      stillPending++;
      continue;
    }
    const result = await resendItem(item.id, idToken);
    if (result.ok) succeeded++;
    else stillPending++;
  }
  return { succeeded, stillPending };
}
