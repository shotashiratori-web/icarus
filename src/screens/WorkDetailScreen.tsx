import { useEffect, useState } from 'react';
import { fetchWorkDetail, WorkNotFoundError, NetworkUnknownError } from '../api/workApi';
import { TokenExpiredError } from '../api/icarusApi';
import { requestSilentIdToken, renderSignInButton } from '../api/googleAuth';
import type { WorkDetail } from '../types/workLog';
import type { Screen } from '../App';
import styles from './WorkDetailScreen.module.css';

type Props = { go: (s: Screen) => void; workId: string };
type LoadState = 'loading' | 'ready' | 'error' | 'notFound' | 'signedOut';

export default function WorkDetailScreen({ go, workId }: Props) {
  const [detail, setDetail] = useState<WorkDetail | null>(null);
  const [state, setState] = useState<LoadState>('loading');
  const [errorMessage, setErrorMessage] = useState('');
  const [signInEl, setSignInEl] = useState<HTMLDivElement | null>(null);

  const load = async (idToken: string) => {
    setState('loading');
    try {
      const result = await fetchWorkDetail(workId, idToken);
      setDetail(result);
      setState('ready');
    } catch (e) {
      if (e instanceof TokenExpiredError) {
        setState('signedOut');
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
    void requestSilentIdToken().then((token) => (token ? load(token) : setState('signedOut')));
  };

  useEffect(() => {
    let cancelled = false;
    requestSilentIdToken().then((token) => {
      if (cancelled) return;
      if (token) {
        void load(token);
      } else {
        setState('signedOut');
      }
    });
    return () => { cancelled = true; };
  }, [workId]);

  useEffect(() => {
    if (state !== 'signedOut' || !signInEl) return;
    void renderSignInButton(signInEl, (token) => {
      void load(token);
    });
  }, [state, signInEl]);

  return (
    <div className={styles.root}>
      <header className={styles.header}>
        <button className={styles.back} onClick={() => go({ name: 'processing' })}>← 一覧</button>
        <span className={styles.title}>{detail?.title || '作業詳細'}</span>
      </header>

      <main className={styles.main}>
        {state === 'loading' && (
          <div className={styles.skeletonList}>
            {[0, 1, 2].map((i) => (<div key={i} className={styles.skeletonItem} />))}
          </div>
        )}

        {state === 'signedOut' && (
          <div className={styles.signInBox}>
            <p className={styles.hintText}>ログインすると作業の詳細を確認できます</p>
            <div ref={setSignInEl} />
          </div>
        )}

        {state === 'error' && (
          <div className={styles.errorBox}>
            <p className={styles.errorText}>{errorMessage}</p>
            <button className={styles.retryBtn} onClick={retry}>再読み込み</button>
          </div>
        )}

        {state === 'notFound' && (
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
    </div>
  );
}
