import { useEffect } from 'react';
import type { FieldLogEntry } from '../../types/zukan';
import styles from './PopupPhoto.module.css';

// 地図の点の小窓に Field Log の写真（縮小版）を出す。押すと大きく（2026-10-19 ユーザー要望「写真は出せない？」）。
// 写真の URL は図鑑の地図と同じ（thumbnailUrl || photoUrl）。端末キャッシュで期限切れなら出さずに知らせる
type PhotoEntry = Pick<FieldLogEntry, 'thumbnailUrl' | 'photoUrl' | 'imageExpired' | 'foodName' | 'memo'>;

export function PopupPhoto({ entry, onZoom }: { entry: PhotoEntry; onZoom: (url: string) => void }) {
  const src = entry.thumbnailUrl || entry.photoUrl;
  // 中身が無い時も改行の代わりになるよう、いつも 1 つの段落（div）で返す
  return (
    <div className={styles.wrap}>
      {entry.memo && <div className={styles.memo}>{entry.memo}</div>}
      {src && entry.imageExpired && <div className={styles.note}>写真は再取得待ち（電波のある所で開き直すと出ます）</div>}
      {src && !entry.imageExpired && (
        <button type="button" className={styles.photoBtn} onClick={() => onZoom(entry.photoUrl || src)} aria-label="写真を大きく見る">
          <img className={styles.photo} src={src} alt={entry.foodName || '写真'} loading="lazy" />
        </button>
      )}
    </div>
  );
}

export function PhotoZoom({ url, onClose }: { url: string; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className={styles.zoom} role="dialog" aria-label="写真を拡大" onClick={onClose}>
      <img className={styles.zoomImg} src={url} alt="拡大した写真" />
      <button type="button" className={styles.close} onClick={onClose} aria-label="閉じる">×</button>
    </div>
  );
}
