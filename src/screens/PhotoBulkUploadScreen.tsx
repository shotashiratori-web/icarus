import { useEffect, useRef, useState } from 'react';
import { resizeToJpeg, extractExifDate, extractExifGps } from '../api/icarusApi';
import { emptyCommonFields, emptyPhotoEntry, todayString, type PhotoEntry } from '../types/foodLog';
import { useAuth } from '../context/AuthContext';
import { submitWithFallback } from '../submission/orchestrator';
import type { FoodLogSubmissionPayload } from '../submission/adapters/foodLogAdapter';
import {
  putBatchItem, updateBatchItemStatus, deleteBatchItem, recoverIncompleteBatchItems,
  type PhotoBatchStatus,
} from '../db/photoBatchDB';
import type { Screen } from '../App';
import styles from './PhotoBulkUploadScreen.module.css';

type Props = { go: (s: Screen) => void };

interface Item {
  requestId: string;
  fileName: string;
  fileBlob: Blob;
  status: PhotoBatchStatus;
  previewUrl?: string;
}

const STATUS_LABEL: Record<PhotoBatchStatus, string> = {
  queued: '待機中',
  processing: '処理中…',
  completed: '送信済み',
  pending: '保留（あとで再送）',
};

export default function PhotoBulkUploadScreen({ go }: Props) {
  const { idToken, authState, handleTokenExpired, signInContainerRef } = useAuth();
  const [items, setItems] = useState<Item[]>([]);
  const [sending, setSending] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [hasStartedOnce, setHasStartedOnce] = useState(false);
  const batchIdRef = useRef<string>(crypto.randomUUID());
  const pauseRef = useRef(false);

  // 起動時: 前回タブが閉じられた/再読み込みされたことで中断されたバッチがあれば復元する
  useEffect(() => {
    recoverIncompleteBatchItems().then((recovered) => {
      if (recovered.length === 0) return;
      setItems((prev) => [
        ...prev,
        ...recovered.map((it) => ({
          requestId: it.requestId,
          fileName: it.fileName,
          fileBlob: it.fileBlob,
          status: it.status,
        })),
      ]);
      setHasStartedOnce(true);
    });
  }, []);

  const addFiles = async (files: File[]) => {
    const imageFiles = files.filter((f) => f.type.startsWith('image/'));
    const now = new Date().toISOString();
    const newItems: Item[] = [];
    for (const file of imageFiles) {
      const requestId = crypto.randomUUID();
      await putBatchItem({
        requestId,
        batchId: batchIdRef.current,
        fileName: file.name,
        fileBlob: file,
        status: 'queued',
        createdAt: now,
        updatedAt: now,
      });
      newItems.push({ requestId, fileName: file.name, fileBlob: file, status: 'queued' });
    }
    setItems((prev) => [...prev, ...newItems]);
  };

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    void addFiles(Array.from(e.target.files ?? []));
    e.target.value = '';
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragActive(false);
    void addFiles(Array.from(e.dataTransfer.files ?? []));
  };

  const updateLocalItem = (requestId: string, patch: Partial<Item>) => {
    setItems((prev) => prev.map((it) => (it.requestId === requestId ? { ...it, ...patch } : it)));
  };

  // 1件処理する。送信前にprocessingへ永続化し、タブが閉じられても「どこまで進んだか」が残るようにする。
  // requestIdは常に固定（キュー投入時に採番したもの）を使い、再開時の再送でもGAS側の重複排除に乗る。
  const processOne = async (item: Item) => {
    updateLocalItem(item.requestId, { status: 'processing' });
    await updateBatchItemStatus(item.requestId, 'processing');
    try {
      const file = item.fileBlob as File;
      const [base64, exif, exifGps] = await Promise.all([
        resizeToJpeg(file),
        extractExifDate(file),
        extractExifGps(file),
      ]);
      const previewUrl = `data:image/jpeg;base64,${base64}`;
      const entry: PhotoEntry = {
        ...emptyPhotoEntry(),
        requestId: item.requestId,
        base64,
        previewUrl,
        date: exif?.date || todayString(),
        takenAt: exif?.takenAt,
        gps: exifGps ? { ...exifGps, accuracy: 0 } : undefined,
      };
      const { previewUrl: _pv, ...photoForPayload } = entry;
      const payload: FoodLogSubmissionPayload = { photo: photoForPayload, common: emptyCommonFields() };

      const outcome = await submitWithFallback({
        entity: 'foodLog',
        itemId: entry.requestId,
        payload,
        title: `(食材名未入力) ${item.fileName}`,
        photoThumbnail: previewUrl,
        displayDate: entry.date,
        idToken,
      });

      if (outcome.ok) {
        updateLocalItem(item.requestId, { status: 'completed', previewUrl });
        await deleteBatchItem(item.requestId);
      } else {
        updateLocalItem(item.requestId, { status: 'pending', previewUrl });
        await updateBatchItemStatus(item.requestId, 'pending');
        if (outcome.item.lastError?.code === 'AUTH_EXPIRED') handleTokenExpired();
      }
    } catch {
      // EXIF抽出等、送信より前の処理が失敗した場合。requestIdは維持したままqueuedへ戻し、再試行できるようにする
      updateLocalItem(item.requestId, { status: 'queued' });
      await updateBatchItemStatus(item.requestId, 'queued');
    }
  };

  const startSend = async () => {
    setSending(true);
    setHasStartedOnce(true);
    pauseRef.current = false;
    const toProcess = items.filter((it) => it.status === 'queued');
    for (const item of toProcess) {
      if (pauseRef.current) break;
      await processOne(item);
    }
    setSending(false);
  };

  const requestPause = () => {
    pauseRef.current = true;
  };

  const counts = items.reduce(
    (acc, it) => {
      acc[it.status] += 1;
      return acc;
    },
    { queued: 0, processing: 0, completed: 0, pending: 0 } as Record<PhotoBatchStatus, number>,
  );

  const hasQueued = counts.queued > 0;

  return (
    <div className={styles.root}>
      <header className={styles.header}>
        <button className={styles.back} onClick={() => go({ name: 'home' })}>← ホーム</button>
        <span className={styles.title}>PC一括写真送信</span>
      </header>

      <main className={styles.main}>
        {authState === 'signedOut' && (
          <div className={styles.signInBox}>
            <p className={styles.hintText}>ログインしてください</p>
            <div ref={signInContainerRef} />
          </div>
        )}

        <p className={styles.description}>
          食材名・場所などは入力せず、写真だけをまとめて送信します。撮影日時・GPSは写真から自動取得します。
          送信後は食材ログに「未整理」の記録として保存され、あとから食材名などを追記できます。
          選択した写真は送信前に端末へ保存されるため、送信中にタブを閉じても後で再開できます。
        </p>

        <div
          className={`${styles.dropZone} ${dragActive ? styles.dropZoneActive : ''}`}
          onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
          onDragLeave={() => setDragActive(false)}
          onDrop={handleDrop}
          onClick={() => document.getElementById('photoBulkInput')?.click()}
        >
          <span className={styles.dropZoneText}>クリックして写真を選択、またはここに複数の写真をドラッグ&ドロップ</span>
          <input
            id="photoBulkInput"
            type="file"
            accept="image/*"
            multiple
            className={styles.hiddenInput}
            onChange={handleFileInput}
          />
        </div>

        {items.length > 0 && (
          <>
            <div className={styles.summaryRow}>
              <span>残り: {counts.queued}</span>
              <span>完了: {counts.completed}</span>
              <span>保留: {counts.pending}</span>
              {counts.processing > 0 && <span>処理中: {counts.processing}</span>}
            </div>

            <div className={styles.actionsRow}>
              <button
                className={styles.sendBtn}
                onClick={startSend}
                disabled={!idToken || sending || !hasQueued}
              >
                {sending ? '送信中…' : hasStartedOnce ? '再開する' : '送信を開始する'}
              </button>
              {sending && (
                <button className={styles.pauseBtn} onClick={requestPause}>
                  送信を中断
                </button>
              )}
            </div>

            {counts.pending > 0 && (
              <p className={styles.hintText}>
                保留中の写真は
                <button className={styles.linkBtn} onClick={() => go({ name: 'pendingList' })}>保留一覧</button>
                から再送できます。
              </p>
            )}

            <ul className={styles.list}>
              {items.map((it) => (
                <li key={it.requestId} className={styles.item}>
                  {it.previewUrl && <img src={it.previewUrl} alt="" className={styles.thumb} />}
                  <div className={styles.itemBody}>
                    <p className={styles.itemName}>{it.fileName}</p>
                    <span className={styles.itemStatus}>{STATUS_LABEL[it.status]}</span>
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
      </main>
    </div>
  );
}
