import { useEffect, useState } from 'react';
import { fetchWorkDetail, WorkNotFoundError, NetworkUnknownError } from '../api/workApi';
import { TokenExpiredError } from '../api/icarusApi';
import { useAuth } from '../context/AuthContext';
import type { WorkDetail } from '../types/workLog';
import type { Screen } from '../App';
import HomeButton from '../components/HomeButton';
import styles from './WorkDetailScreen.module.css';

type Props = { go: (s: Screen) => void; workId: string };
type LoadState = 'loading' | 'ready' | 'error' | 'notFound';

export default function WorkDetailScreen({ go, workId }: Props) {
  const { idToken, authState, signInContainerRef, handleTokenExpired } = useAuth();
  const [detail, setDetail] = useState<WorkDetail | null>(null);
  const [state, setState] = useState<LoadState>('loading');
  const [errorMessage, setErrorMessage] = useState('');
  const [galleryIndex, setGalleryIndex] = useState<number | null>(null);

  const photos = detail?.photos ?? [];
  const closeGallery = () => setGalleryIndex(null);
  const showPrev = () => setGalleryIndex((i) => (i === null ? null : Math.max(0, i - 1)));
  const showNext = () => setGalleryIndex((i) => (i === null ? null : Math.min(photos.length - 1, i + 1)));

  // ギャラリー表示中はEscで閉じる、矢印キーで前後移動できるようにする
  useEffect(() => {
    if (galleryIndex === null) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeGallery();
      else if (e.key === 'ArrowLeft') showPrev();
      else if (e.key === 'ArrowRight') showNext();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [galleryIndex, photos.length]);

  const load = async (token: string) => {
    setState('loading');
    try {
      const result = await fetchWorkDetail(workId, token);
      setDetail(result);
      setState('ready');
    } catch (e) {
      if (e instanceof TokenExpiredError) {
        handleTokenExpired();
        return;
      }
      if (e instanceof WorkNotFoundError) {
        setState('notFound');
        return;
      }
      setErrorMessage(
        e instanceof NetworkUnknownError ? e.message : e instanceof Error ? e.message : '取得に失敗しました',
      );
      setState('error');
    }
  };

  const retry = () => {
    if (idToken) void load(idToken);
  };

  useEffect(() => {
    if (authState === 'ready' && idToken) void load(idToken);
  }, [authState, idToken, workId]);

  return (
    <div className={styles.root}>
      <header className={styles.header}>
        <button className={styles.back} onClick={() => go({ name: 'processing' })}>← 一覧</button>
        <span className={styles.title}>{detail?.title || '作業詳細'}</span>
        <HomeButton go={go} />
      </header>

      <main className={styles.main}>
        {(authState === 'checking' || (authState === 'ready' && state === 'loading')) && (
          <div className={styles.skeletonList}>
            {[0, 1, 2].map((i) => (<div key={i} className={styles.skeletonItem} />))}
          </div>
        )}

        {authState === 'signedOut' && (
          <div className={styles.signInBox}>
            <p className={styles.hintText}>ログインすると作業の詳細を確認できます</p>
            <div ref={signInContainerRef} />
          </div>
        )}

        {authState === 'ready' && state === 'error' && (
          <div className={styles.errorBox}>
            <p className={styles.errorText}>{errorMessage}</p>
            <button className={styles.retryBtn} onClick={retry}>再読み込み</button>
          </div>
        )}

        {authState === 'ready' && state === 'notFound' && (
          <div className={styles.errorBox}>
            <p className={styles.errorText}>作業が見つかりません</p>
            <button className={styles.retryBtn} onClick={() => go({ name: 'processing' })}>一覧へ戻る</button>
          </div>
        )}

        {state === 'ready' && detail && (
          <>
            <section className={styles.summary}>
              {detail.photoUrl && (
                <img src={detail.photoUrl} alt="" className={styles.summaryPhoto} loading="lazy" />
              )}
              <dl className={styles.summaryList}>
                <dt>種別</dt> <dd>{detail.type || '—'}</dd>
                <dt>開始日</dt> <dd>{detail.startDate.slice(0, 16).replace('T', ' ')}</dd>
                <dt>最終更新</dt> <dd>{detail.lastUpdated.slice(0, 16).replace('T', ' ')}</dd>
              </dl>
              <button
                className={styles.addBtn}
                onClick={() => go({ name: 'workForm', mode: 'append', workId: detail.workId, workTitle: detail.title })}
              >
                ＋ この作業に記録を追加
              </button>
            </section>

            {photos.length > 0 && (
              <section className={styles.section}>
                <h2 className={styles.sectionTitle}>写真 ({photos.length})</h2>
                <div className={styles.photoStrip}>
                  {photos.map((p, i) => (
                    <button
                      key={p.photoUrl}
                      className={styles.photoThumbBtn}
                      onClick={() => setGalleryIndex(i)}
                    >
                      <img src={p.photoUrl} alt="" className={styles.photoThumb} loading="lazy" />
                    </button>
                  ))}
                </div>
              </section>
            )}

            <section className={styles.section}>
              <h2 className={styles.sectionTitle}>記録 ({detail.entries.length})</h2>
              {detail.entries.length === 0 && (
                <p className={styles.empty}>まだ記録がありません。</p>
              )}
              <div className={styles.list}>
                {detail.entries.map((entry, i) => (
                  <div key={i} className={styles.entry}>
                    {entry.photoUrl ? (
                      <img src={entry.photoUrl} alt="" className={styles.entryPhoto} loading="lazy" />
                    ) : (
                      <div className={styles.entryPhotoPlaceholder}>🧂</div>
                    )}
                    <div className={styles.entryInfo}>
                      <p className={styles.entryDate}>{entry.datetime.slice(0, 16).replace('T', ' ')}</p>
                      {entry.content && <p className={styles.entryContent}>{entry.content}</p>}
                      {entry.caption && <p className={styles.entryCaption}>{entry.caption}</p>}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          </>
        )}
      </main>

      {galleryIndex !== null && photos[galleryIndex] && (
        <div className={styles.lightboxOverlay} onClick={closeGallery}>
          <div className={styles.lightboxContent} onClick={(e) => e.stopPropagation()}>
            <button className={styles.lightboxClose} onClick={closeGallery} aria-label="閉じる">✕</button>
            {galleryIndex > 0 && (
              <button className={`${styles.lightboxNav} ${styles.lightboxPrev}`} onClick={showPrev} aria-label="前の写真">‹</button>
            )}
            <img src={photos[galleryIndex].photoUrl} alt="" className={styles.lightboxImg} />
            {galleryIndex < photos.length - 1 && (
              <button className={`${styles.lightboxNav} ${styles.lightboxNext}`} onClick={showNext} aria-label="次の写真">›</button>
            )}
            <div className={styles.lightboxFooter}>
              {photos[galleryIndex].caption && <p className={styles.lightboxCaption}>{photos[galleryIndex].caption}</p>}
              <p className={styles.lightboxCount}>{galleryIndex + 1} / {photos.length}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
