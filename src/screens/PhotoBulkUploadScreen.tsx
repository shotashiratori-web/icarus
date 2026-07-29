import { useState } from 'react';
import { resizeToJpeg, extractExifDate, extractExifGps } from '../api/icarusApi';
import { emptyCommonFields, emptyPhotoEntry, todayString, type PhotoEntry } from '../types/foodLog';
import { useAuth } from '../context/AuthContext';
import { submitWithFallback } from '../submission/orchestrator';
import type { FoodLogSubmissionPayload } from '../submission/adapters/foodLogAdapter';
import type { Screen } from '../App';
import styles from './PhotoBulkUploadScreen.module.css';

type Props = { go: (s: Screen) => void };
type ItemStatus = 'idle' | 'processing' | 'success' | 'queued' | 'error';

interface Item {
  file: File;
  status: ItemStatus;
  previewUrl?: string;
}

const STATUS_LABEL: Record<ItemStatus, string> = {
  idle: '待機中',
  processing: '処理中…',
  success: '送信済み',
  queued: '保留（あとで再送）',
  error: '処理失敗',
};

export default function PhotoBulkUploadScreen({ go }: Props) {
  const { idToken, authState, handleTokenExpired, signInContainerRef } = useAuth();
  const [items, setItems] = useState<Item[]>([]);
  const [sending, setSending] = useState(false);
  const [dragActive, setDragActive] = useState(false);

  const addFiles = (files: File[]) => {
    const imageFiles = files.filter((f) => f.type.startsWith('image/'));
    setItems((prev) => [...prev, ...imageFiles.map((file) => ({ file, status: 'idle' as ItemStatus }))]);
  };

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    addFiles(Array.from(e.target.files ?? []));
    e.target.value = '';
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragActive(false);
    addFiles(Array.from(e.dataTransfer.files ?? []));
  };

  const updateItem = (idx: number, patch: Partial<Item>) => {
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  };

  // 1枚ずつ順番に処理する（EXIF抽出・base64化・送信）。同時に複数枚をメモリへ持たないための逐次処理。
  const processOne = async (idx: number) => {
    const file = items[idx].file;
    updateItem(idx, { status: 'processing' });
    try {
      const [base64, exif, exifGps] = await Promise.all([
        resizeToJpeg(file),
        extractExifDate(file),
        extractExifGps(file),
      ]);
      const previewUrl = `data:image/jpeg;base64,${base64}`;
      const entry: PhotoEntry = {
        ...emptyPhotoEntry(),
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
        title: `(食材名未入力) ${file.name}`,
        photoThumbnail: previewUrl,
        displayDate: entry.date,
        idToken,
      });

      if (outcome.ok) {
        updateItem(idx, { status: 'success', previewUrl });
      } else {
        updateItem(idx, { status: 'queued', previewUrl });
        if (outcome.item.lastError?.code === 'AUTH_EXPIRED') handleTokenExpired();
      }
    } catch {
      updateItem(idx, { status: 'error' });
    }
  };

  const startSend = async () => {
    setSending(true);
    for (let i = 0; i < items.length; i++) {
      if (items[i].status === 'success' || items[i].status === 'queued') continue;
      await processOne(i);
    }
    setSending(false);
  };

  const counts = items.reduce(
    (acc, it) => {
      acc[it.status] += 1;
      return acc;
    },
    { idle: 0, processing: 0, success: 0, queued: 0, error: 0 } as Record<ItemStatus, number>,
  );

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
              <span>選択中: {items.length}件</span>
              <span>送信済み: {counts.success}</span>
              <span>保留: {counts.queued}</span>
              {counts.error > 0 && <span className={styles.errorCount}>失敗: {counts.error}</span>}
            </div>

            <button
              className={styles.sendBtn}
              onClick={startSend}
              disabled={!idToken || sending || items.every((it) => it.status === 'success' || it.status === 'queued')}
            >
              {sending ? '送信中…' : '送信を開始する'}
            </button>

            {counts.error > 0 && !sending && (
              <p className={styles.errorHint}>
                処理に失敗した写真があります。この画面を離れると失われます。「再試行」を押してください。
              </p>
            )}

            <ul className={styles.list}>
              {items.map((it, idx) => (
                <li key={idx} className={styles.item}>
                  {it.previewUrl && <img src={it.previewUrl} alt="" className={styles.thumb} />}
                  <div className={styles.itemBody}>
                    <p className={styles.itemName}>{it.file.name}</p>
                    <span className={styles.itemStatus}>{STATUS_LABEL[it.status]}</span>
                    {it.status === 'error' && (
                      <button className={styles.retryBtn} onClick={() => void processOne(idx)} disabled={sending}>
                        再試行
                      </button>
                    )}
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
