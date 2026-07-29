import { getDB, PHOTO_BATCH_STORE } from './localDB';

// PC一括写真送信専用の永続化。既存Submission Framework（submission_queue）とは別物:
// あちらは「送信に失敗した記録」だけを持つのに対し、こちらは選択された全写真を
// 送信開始前からqueued状態で保持し、タブが閉じられても再開できるようにする。
// 'error' = 未対応形式・デコード失敗など、リトライしても直らない恒久的な失敗。
// 通信失敗等の一時エラー（'pending'）とは区別し、自動では再送しない。
export type PhotoBatchStatus = 'queued' | 'processing' | 'completed' | 'pending' | 'error';

export interface PhotoBatchItem {
  requestId: string; // 主キー。Food Log送信時のrequestIdと同一にし、再開時も使い回すことでGAS側の重複排除に乗る
  batchId: string;
  fileName: string;
  fileBlob: Blob;
  fileHash: string; // 重複写真チェック用のSHA-256（元ファイルのバイト列）
  status: PhotoBatchStatus;
  lastError?: string; // status === 'error' のときの理由（UI表示用）
  createdAt: string;
  updatedAt: string;
}

export async function putBatchItem(item: PhotoBatchItem): Promise<void> {
  const db = await getDB();
  await db.put(PHOTO_BATCH_STORE, item);
}

export async function updateBatchItemStatus(
  requestId: string,
  status: PhotoBatchStatus,
  lastError?: string,
): Promise<void> {
  const db = await getDB();
  const existing = await db.get(PHOTO_BATCH_STORE, requestId);
  if (!existing) return;
  await db.put(PHOTO_BATCH_STORE, { ...existing, status, lastError, updatedAt: new Date().toISOString() });
}

export async function deleteBatchItem(requestId: string): Promise<void> {
  const db = await getDB();
  await db.delete(PHOTO_BATCH_STORE, requestId);
}

// 起動時に一度だけ呼ぶ。processingのまま残っている項目は、前回タブが閉じられた/再読み込みされた
// ことを意味するのでqueuedへ戻す。completedは呼び出し側で送信成功時に削除済みのためここには現れない。
export async function recoverIncompleteBatchItems(): Promise<PhotoBatchItem[]> {
  const db = await getDB();
  const all: PhotoBatchItem[] = await db.getAll(PHOTO_BATCH_STORE);
  const now = new Date().toISOString();
  const recovered: PhotoBatchItem[] = [];
  for (const item of all) {
    if (item.status === 'processing') {
      const reset: PhotoBatchItem = { ...item, status: 'queued', updatedAt: now };
      await db.put(PHOTO_BATCH_STORE, reset);
      recovered.push(reset);
    } else {
      recovered.push(item);
    }
  }
  return recovered;
}
