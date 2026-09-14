import { useEffect, useState } from 'react';
import {
  fetchWorkDetail, voidWorkEntry, correctWorkEntry, WorkNotFoundError, NetworkUnknownError,
  WorkCorrectionConflictError,
} from '../api/workApi';
import { TokenExpiredError } from '../api/icarusApi';
import { useAuth } from '../context/AuthContext';
import type { WorkDetail, WorkEntry } from '../types/workLog';
import type { Screen } from '../App';
import HomeButton from '../components/HomeButton';
import Lightbox from '../components/Lightbox';
import styles from './WorkDetailScreen.module.css';

type Props = { go: (s: Screen) => void; workId: string };
type LoadState = 'loading' | 'ready' | 'error' | 'notFound';

export default function WorkDetailScreen({ go, workId }: Props) {
  const { idToken, authState, staffMe, signInContainerRef, handleTokenExpired } = useAuth();
  const [detail, setDetail] = useState<WorkDetail | null>(null);
  const [state, setState] = useState<LoadState>('loading');
  const [errorMessage, setErrorMessage] = useState('');
  const [galleryIndex, setGalleryIndex] = useState<number | null>(null);

  // Work Log Void v1。成功後は該当entryを即座にローカルから隠す（楽観的非表示、Cron待ちのUXギャップを埋める）。
  // 失敗時はvoidingSheetRowByで押していたentryだけ元に戻し、その場でエラーを表示する
  const [hiddenSheetRows, setHiddenSheetRows] = useState<Set<number>>(new Set());
  const [voidingSheetRow, setVoidingSheetRow] = useState<number | null>(null);
  const [voidError, setVoidError] = useState<{ sheetRow: number; message: string } | null>(null);
  const isAdmin = staffMe?.role === 'admin';

  // Work Log Correction v1。成功後はcontent/captionをローカルへ即時反映（楽観的更新、Cron待ちの
  // UXギャップを埋める——Voidのhiddenと同じ考え方）。編集フォームは1entryずつ、インライン表示
  const [correctedEntries, setCorrectedEntries] = useState<Map<number, { content: string; caption: string }>>(new Map());
  const [editingSheetRow, setEditingSheetRow] = useState<number | null>(null);
  const [editContent, setEditContent] = useState('');
  const [editCaption, setEditCaption] = useState('');
  const [savingSheetRow, setSavingSheetRow] = useState<number | null>(null);
  const [correctError, setCorrectError] = useState<{ sheetRow: number; message: string } | null>(null);

  const effectiveEntry = (entry: WorkEntry): WorkEntry => {
    const override = correctedEntries.get(entry.sheetRow);
    return override ? { ...entry, content: override.content, caption: override.caption } : entry;
  };

  const photos = detail?.photos ?? [];
  const lightboxPhotos = photos.map((p) => ({ url: p.photoUrl, caption: p.caption || undefined }));

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

  const handleVoid = async (sheetRow: number) => {
    if (!idToken || !detail) return;
    if (!confirm('この記録を無効化します。一覧から見えなくなります。よろしいですか？')) return;

    setVoidingSheetRow(sheetRow);
    setVoidError(null);
    try {
      await voidWorkEntry(detail.workId, sheetRow, '', idToken);
      setHiddenSheetRows((prev) => new Set(prev).add(sheetRow));
    } catch (e) {
      if (e instanceof TokenExpiredError) {
        handleTokenExpired();
        return;
      }
      setVoidError({
        sheetRow,
        message: e instanceof NetworkUnknownError ? e.message : e instanceof Error ? e.message : '無効化に失敗しました',
      });
    } finally {
      setVoidingSheetRow(null);
    }
  };

  const startEdit = (entry: WorkEntry) => {
    const eff = effectiveEntry(entry);
    setEditingSheetRow(entry.sheetRow);
    setEditContent(eff.content);
    setEditCaption(eff.caption);
    setCorrectError(null);
  };

  const cancelEdit = () => {
    setEditingSheetRow(null);
    setCorrectError(null);
  };

  const handleCorrect = async (entry: WorkEntry) => {
    if (!idToken || !detail) return;
    const eff = effectiveEntry(entry);

    setSavingSheetRow(entry.sheetRow);
    setCorrectError(null);
    try {
      const result = await correctWorkEntry(
        detail.workId, entry.sheetRow, editContent, editCaption, eff.content, eff.caption, '', idToken,
      );
      setCorrectedEntries((prev) => {
        const next = new Map(prev);
        next.set(entry.sheetRow, { content: result.content, caption: result.caption });
        return next;
      });
      setEditingSheetRow(null);
    } catch (e) {
      if (e instanceof TokenExpiredError) {
        handleTokenExpired();
        return;
      }
      if (e instanceof WorkCorrectionConflictError) {
        // 競合時はサーバー側の最新値をそのまま取り込み、その場で見比べながら再編集できるようにする
        setCorrectedEntries((prev) => {
          const next = new Map(prev);
          next.set(entry.sheetRow, { content: e.currentContent, caption: e.currentCaption });
          return next;
        });
        setEditContent(e.currentContent);
        setEditCaption(e.currentCaption);
        setCorrectError({ sheetRow: entry.sheetRow, message: `${e.message}（内容を最新に更新しました。確認のうえ再度保存してください）` });
        return;
      }
      setCorrectError({
        sheetRow: entry.sheetRow,
        message: e instanceof NetworkUnknownError ? e.message : e instanceof Error ? e.message : '訂正に失敗しました',
      });
    } finally {
      setSavingSheetRow(null);
    }
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
              {(() => {
                const visibleEntries = detail.entries.filter((e) => !hiddenSheetRows.has(e.sheetRow));
                return (
                  <>
                    <h2 className={styles.sectionTitle}>記録 ({visibleEntries.length})</h2>
                    {visibleEntries.length === 0 && (
                      <p className={styles.empty}>まだ記録がありません。</p>
                    )}
                    <div className={styles.list}>
                      {visibleEntries.map((entry) => {
                        const eff = effectiveEntry(entry);
                        const isEditing = editingSheetRow === entry.sheetRow;
                        const isSaving = savingSheetRow === entry.sheetRow;
                        return (
                          <div key={entry.sheetRow} className={styles.entry}>
                            {eff.photoUrl ? (
                              <img src={eff.photoUrl} alt="" className={styles.entryPhoto} loading="lazy" />
                            ) : (
                              <div className={styles.entryPhotoPlaceholder}>🧂</div>
                            )}
                            <div className={styles.entryInfo}>
                              <p className={styles.entryDate}>{entry.datetime.slice(0, 16).replace('T', ' ')}</p>

                              {isEditing ? (
                                <div className={styles.correctForm}>
                                  <textarea
                                    className={styles.correctTextarea}
                                    value={editContent}
                                    onChange={(e) => setEditContent(e.target.value)}
                                    rows={3}
                                    disabled={isSaving}
                                  />
                                  <input
                                    className={styles.correctInput}
                                    value={editCaption}
                                    onChange={(e) => setEditCaption(e.target.value)}
                                    placeholder="キャプション（任意）"
                                    disabled={isSaving}
                                  />
                                  <div className={styles.correctActions}>
                                    <button
                                      className={styles.correctSaveBtn}
                                      disabled={isSaving || !editContent.trim()}
                                      onClick={() => void handleCorrect(entry)}
                                    >
                                      {isSaving ? '保存中…' : '保存'}
                                    </button>
                                    <button
                                      className={styles.correctCancelBtn}
                                      disabled={isSaving}
                                      onClick={cancelEdit}
                                    >
                                      キャンセル
                                    </button>
                                  </div>
                                </div>
                              ) : (
                                <>
                                  {eff.content && <p className={styles.entryContent}>{eff.content}</p>}
                                  {eff.caption && <p className={styles.entryCaption}>{eff.caption}</p>}
                                </>
                              )}

                              {correctError?.sheetRow === entry.sheetRow && (
                                <p className={styles.correctErrorText}>{correctError.message}</p>
                              )}

                              {isAdmin && !isEditing && (
                                <div className={styles.adminActions}>
                                  <button
                                    className={styles.correctBtn}
                                    onClick={() => startEdit(entry)}
                                  >
                                    訂正
                                  </button>
                                  <button
                                    className={styles.voidBtn}
                                    disabled={voidingSheetRow === entry.sheetRow}
                                    onClick={() => void handleVoid(entry.sheetRow)}
                                  >
                                    {voidingSheetRow === entry.sheetRow ? '無効化中…' : 'この記録を無効化'}
                                  </button>
                                </div>
                              )}
                              {voidError?.sheetRow === entry.sheetRow && (
                                <p className={styles.voidErrorText}>{voidError.message}</p>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </>
                );
              })()}
            </section>
          </>
        )}
      </main>

      <Lightbox photos={lightboxPhotos} index={galleryIndex} setIndex={setGalleryIndex} />
    </div>
  );
}
