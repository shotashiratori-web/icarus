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
import EditFooter from '../components/edit/EditFooter';
import ConflictBanner from '../components/edit/ConflictBanner';
import EditHistoryList, { type EditHistoryViewItem } from '../components/edit/EditHistoryList';
import { diffByKeys, rebaseByKeys } from '../utils/editCore';
import { fetchWorkEntryCorrections } from '../api/workCorrectionsApi';
import styles from './WorkDetailScreen.module.css';

type Props = { go: (s: Screen) => void; workId: string };

// Work Log Staff Correction（2026-09-27）: 訂正は active staff、無効化は admin のまま。
// サーバーの Correction 契約（Sheets 正本・expected old value・訂正履歴タブ）は変えず、
// 体験だけ Field と揃える（自分の入力を残す競合処理・変更する項目の表示・訂正履歴）
type CorrectionValues = { content: string; caption: string };
const CORRECTION_KEYS = ['content', 'caption'] as const;
const CORRECTION_LABELS: Record<keyof CorrectionValues, string> = { content: '本文', caption: 'キャプション' };

function toHistoryItems(items: Awaited<ReturnType<typeof fetchWorkEntryCorrections>>): EditHistoryViewItem[] {
  return [...items].reverse().map((it, i) => ({
    id: `${it.correctedAt}-${i}`,
    editedAt: it.correctedAt,
    actorName: it.correctedByName,
    sourceLabel: '訂正',
    reason: it.note || null,
    changes: [
      ...(it.oldContent !== it.newContent ? [{ label: '本文', old: it.oldContent, new: it.newContent }] : []),
      ...(it.oldCaption !== it.newCaption ? [{ label: 'キャプション', old: it.oldCaption, new: it.newCaption }] : []),
    ],
  }));
}
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
  const canCorrect = staffMe?.staffStatus === 'active';

  // Work Log Correction v1。成功後はcontent/captionをローカルへ即時反映（楽観的更新、Cron待ちの
  // UXギャップを埋める——Voidのhiddenと同じ考え方）。編集フォームは1entryずつ、インライン表示
  const [correctedEntries, setCorrectedEntries] = useState<Map<number, CorrectionValues>>(new Map());
  const [editingSheetRow, setEditingSheetRow] = useState<number | null>(null);
  // base = 編集を始めた時点（競合後は最新）の値。サーバーへ expected として送る
  const [editBase, setEditBase] = useState<CorrectionValues>({ content: '', caption: '' });
  const [editContent, setEditContent] = useState('');
  const [editCaption, setEditCaption] = useState('');
  const [savingSheetRow, setSavingSheetRow] = useState<number | null>(null);
  const [correctError, setCorrectError] = useState<{ sheetRow: number; message: string } | null>(null);
  const [conflict, setConflict] = useState<{ mine: string[]; overlap: string[] } | null>(null);
  const [showUnsavedConfirm, setShowUnsavedConfirm] = useState(false);

  // 訂正履歴（Sheets「作業ログ_訂正履歴」を読む）。記録ごとに開閉、保存・競合の後は読み直す
  const [historyOpenRow, setHistoryOpenRow] = useState<number | null>(null);
  const [historyItems, setHistoryItems] = useState<EditHistoryViewItem[] | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState('');

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
    setEditBase({ content: eff.content, caption: eff.caption });
    setEditContent(eff.content);
    setEditCaption(eff.caption);
    setCorrectError(null);
    setConflict(null);
    setShowUnsavedConfirm(false);
  };

  const closeEdit = () => {
    setEditingSheetRow(null);
    setCorrectError(null);
    setConflict(null);
    setShowUnsavedConfirm(false);
  };

  const editForm: CorrectionValues = { content: editContent, caption: editCaption };
  const changedLabels = (Object.keys(diffByKeys(CORRECTION_KEYS, editBase, editForm)) as (keyof CorrectionValues)[])
    .map((k) => CORRECTION_LABELS[k]);

  // 変更が無ければそのまま閉じる。あれば「保存されていない変更があります」を出す
  const cancelEdit = () => {
    if (changedLabels.length === 0) closeEdit();
    else setShowUnsavedConfirm(true);
  };

  const loadHistory = async (sheetRow: number) => {
    if (!idToken || !detail) return;
    setHistoryLoading(true);
    setHistoryError('');
    try {
      setHistoryItems(toHistoryItems(await fetchWorkEntryCorrections(detail.workId, sheetRow, idToken)));
    } catch (e) {
      if (e instanceof TokenExpiredError) handleTokenExpired();
      setHistoryError(e instanceof Error ? e.message : '訂正履歴を読み込めませんでした');
    } finally {
      setHistoryLoading(false);
    }
  };

  const toggleHistory = (sheetRow: number) => {
    if (historyOpenRow === sheetRow) {
      setHistoryOpenRow(null);
      return;
    }
    setHistoryOpenRow(sheetRow);
    setHistoryItems(null);
    void loadHistory(sheetRow);
  };

  const handleCorrect = async (entry: WorkEntry) => {
    if (!idToken || !detail) return;

    setSavingSheetRow(entry.sheetRow);
    setCorrectError(null);
    try {
      const result = await correctWorkEntry(
        detail.workId, entry.sheetRow, editContent, editCaption, editBase.content, editBase.caption, '', idToken,
      );
      setCorrectedEntries((prev) => {
        const next = new Map(prev);
        next.set(entry.sheetRow, { content: result.content, caption: result.caption });
        return next;
      });
      closeEdit();
      if (historyOpenRow === entry.sheetRow) void loadHistory(entry.sheetRow);
    } catch (e) {
      if (e instanceof TokenExpiredError) {
        handleTokenExpired();
        return;
      }
      if (e instanceof WorkCorrectionConflictError) {
        // 競合（他の人が先に訂正した）: 最新値を取り込みつつ、自分が変えた項目は自分の入力のまま残す。
        // 自動では再保存しない。次の保存の expected は最新値
        const latest: CorrectionValues = { content: e.currentContent, caption: e.currentCaption };
        const rebased = rebaseByKeys(CORRECTION_KEYS, editBase, editForm, latest);
        setCorrectedEntries((prev) => {
          const next = new Map(prev);
          next.set(entry.sheetRow, latest);
          return next;
        });
        setEditBase(latest);
        setEditContent(rebased.values.content);
        setEditCaption(rebased.values.caption);
        setConflict({
          mine: rebased.mine.map((k) => CORRECTION_LABELS[k]),
          overlap: rebased.overlap.map((k) => CORRECTION_LABELS[k]),
        });
        if (historyOpenRow === entry.sheetRow) void loadHistory(entry.sheetRow);
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
                                  {conflict && <ConflictBanner mineLabels={conflict.mine} overlapLabels={conflict.overlap} />}
                                  <textarea
                                    className={styles.correctTextarea}
                                    value={editContent}
                                    onChange={(e) => setEditContent(e.target.value)}
                                    rows={3}
                                    disabled={isSaving}
                                    aria-label="本文"
                                  />
                                  <input
                                    className={styles.correctInput}
                                    value={editCaption}
                                    onChange={(e) => setEditCaption(e.target.value)}
                                    placeholder="キャプション（任意）"
                                    disabled={isSaving}
                                    aria-label="キャプション"
                                  />
                                  <EditFooter
                                    changedLabels={changedLabels}
                                    isSaving={isSaving}
                                    canSave={!!editContent.trim()}
                                    errorMessage={correctError?.sheetRow === entry.sheetRow ? correctError.message : undefined}
                                    onSave={() => void handleCorrect(entry)}
                                    onClose={closeEdit}
                                    showUnsavedConfirm={showUnsavedConfirm}
                                    onContinueEditing={() => setShowUnsavedConfirm(false)}
                                    onDiscard={closeEdit}
                                  />
                                  {!showUnsavedConfirm && (
                                    <button
                                      className={styles.correctCancelBtn}
                                      disabled={isSaving}
                                      onClick={cancelEdit}
                                    >
                                      キャンセル
                                    </button>
                                  )}
                                </div>
                              ) : (
                                <>
                                  {eff.content && <p className={styles.entryContent}>{eff.content}</p>}
                                  {eff.caption && <p className={styles.entryCaption}>{eff.caption}</p>}
                                </>
                              )}

                              {!isEditing && correctError?.sheetRow === entry.sheetRow && (
                                <p className={styles.correctErrorText}>{correctError.message}</p>
                              )}

                              {canCorrect && !isEditing && (
                                <div className={styles.adminActions}>
                                  <button
                                    className={styles.correctBtn}
                                    onClick={() => startEdit(entry)}
                                  >
                                    訂正
                                  </button>
                                  <button
                                    className={styles.correctBtn}
                                    onClick={() => toggleHistory(entry.sheetRow)}
                                    aria-expanded={historyOpenRow === entry.sheetRow}
                                  >
                                    {historyOpenRow === entry.sheetRow ? '訂正履歴を閉じる' : '訂正履歴'}
                                  </button>
                                </div>
                              )}
                              {historyOpenRow === entry.sheetRow && !isEditing && (
                                <EditHistoryList
                                  items={historyItems}
                                  loading={historyLoading}
                                  errorMessage={historyError}
                                  emptyText="訂正履歴はまだありません"
                                />
                              )}
                              {/* 無効化は admin だけ。訂正とは分けて置く（誤操作を避ける） */}
                              {isAdmin && !isEditing && (
                                <div className={styles.adminActions}>
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
