import { useEffect } from 'react';
import styles from './Lightbox.module.css';

export interface LightboxPhoto {
  url: string;
  caption?: string;
}

type Props = {
  photos: LightboxPhoto[];
  index: number | null;
  setIndex: (updater: (i: number | null) => number | null) => void;
};

// Work Detailで先行実装されたLightboxを、Food Encyclopedia Detailと共有するための切り出し。
// state（galleryIndexとphotos配列）は呼び出し側が持ち、この component は表示とキーボード操作のみを担う
export default function Lightbox({ photos, index, setIndex }: Props) {
  const close = () => setIndex(() => null);
  const showPrev = () => setIndex((i) => (i === null ? null : Math.max(0, i - 1)));
  const showNext = () => setIndex((i) => (i === null ? null : Math.min(photos.length - 1, i + 1)));

  useEffect(() => {
    if (index === null) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
      else if (e.key === 'ArrowLeft') showPrev();
      else if (e.key === 'ArrowRight') showNext();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, photos.length]);

  if (index === null || !photos[index]) return null;

  return (
    <div className={styles.lightboxOverlay} onClick={close}>
      <div className={styles.lightboxContent} onClick={(e) => e.stopPropagation()}>
        <button className={styles.lightboxClose} onClick={close} aria-label="閉じる">✕</button>
        {index > 0 && (
          <button className={`${styles.lightboxNav} ${styles.lightboxPrev}`} onClick={showPrev} aria-label="前の写真">‹</button>
        )}
        <img src={photos[index].url} alt="" className={styles.lightboxImg} />
        {index < photos.length - 1 && (
          <button className={`${styles.lightboxNav} ${styles.lightboxNext}`} onClick={showNext} aria-label="次の写真">›</button>
        )}
        <div className={styles.lightboxFooter}>
          {photos[index].caption && <p className={styles.lightboxCaption}>{photos[index].caption}</p>}
          <p className={styles.lightboxCount}>{index + 1} / {photos.length}</p>
        </div>
      </div>
    </div>
  );
}
