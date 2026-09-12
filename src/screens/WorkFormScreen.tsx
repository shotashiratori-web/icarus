import { useEffect, useRef, useState } from 'react';
import { resizeToJpeg } from '../api/icarusApi';
import { useAuth } from '../context/AuthContext';
import { WORK_TYPE_OPTIONS, nowLocalDatetimeString, type WorkFormMode, type WorkSubmitSuccess } from '../types/workLog';
import { saveWorkLogDraft, loadWorkLogDraft } from '../db/localDB';
import { submitWithFallback } from '../submission/orchestrator';
import type { WorkLogSubmissionPayload } from '../submission/adapters/workLogAdapter';
import type { Screen } from '../App';
import HomeButton from '../components/HomeButton';
import styles from './WorkFormScreen.module.css';

type Phase = 'form' | 'confirm' | 'sending' | 'complete';
type SendOutcome =
  | { kind: 'success'; result: WorkSubmitSuccess | undefined }
  // retryable失敗。draft/queueは端末に残り、App起動時・online復帰時に自動再送される
  | { kind: 'queued' }
  // non-retryable失敗（validation・append先workId不存在等）。queueには載る（Pending Listからの
  // 個別再送は可能）が、自動では再送されない——内容を直さない限り結果は変わらないため、
  // 「保存して先へ進める」ではなくその場で対処を促す（既存のerror画面と同じ体験）
  | { kind: 'blocked'; message: string };

type Props = {
  go: (s: Screen) => void;
  mode: WorkFormMode;
  workId?: string;
  workTitle?: string;
  // 指定時は新規requestIdを発行せず、このrequestIdの下書きを明示的に再開する
  // （「未送信の下書き」一覧からの「続きを編集」導線専用。指定が無ければ常に完全な新規draft）
  draftRequestId?: string;
};

export default function WorkFormScreen({ go, mode, workId, workTitle, draftRequestId }: Props) {
  const { idToken, userEmail, authState, signInContainerRef, handleTokenExpired } = useAuth();
  const [phase, setPhase] = useState<Phase>('form');

  const [requestId, setRequestId] = useState<string>(() => draftRequestId ?? crypto.randomUUID());
  const [title, setTitle] = useState('');
  const [type, setType] = useState('');
  const [content, setContent] = useState('');
  const [datetime, setDatetime] = useState(() => nowLocalDatetimeString());
  const [photoBase64, setPhotoBase64] = useState<string | undefined>(undefined);
  const [previewUrl, setPreviewUrl] = useState('');
  const [caption, setCaption] = useState('');
  const [photoProcessing, setPhotoProcessing] = useState(false);

  const [outcome, setOutcome] = useState<SendOutcome | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const draftLoadedRef = useRef(false);

  const backTarget: Screen = mode === 'append' && workId
    ? { name: 'workDetail', workId }
    : { name: 'processing' };

  // ── 下書きの明示的再開（draftRequestId指定時のみ・mount時に1回）──────────
  // 「未送信の下書き」一覧からの「続きを編集」経由でしか発火しない。mode/workId等からの
  // 自動判定は行わない——同一mode/workIdで複数のdraftが同時に存在しうる（Draft Identity Fix）ため、
  // どれを再開したいかはrequestIdでしか一意に決まらない
  useEffect(() => {
    if (!draftRequestId || draftLoadedRef.current) return;
    draftLoadedRef.current = true;
    void loadWorkLogDraft(draftRequestId).then((draft) => {
      if (!draft) return;
      setTitle(draft.title ?? '');
      setType(draft.type ?? '');
      setContent(draft.content);
      setDatetime(draft.datetime);
      setCaption(draft.caption ?? '');
      if (draft.photoBase64) {
        setPhotoBase64(draft.photoBase64);
        setPreviewUrl(`data:${draft.photoMimeType ?? 'image/jpeg'};base64,${draft.photoBase64}`);
      }
    });
  }, [draftRequestId]);

  // ── 下書き保存（UX-009: 未保存入力の消失を防ぐ。Field Logの下書き機構と同じ思想）────
  // Work Log Draft Identity Fix: keyはrequestId由来（`work:${requestId}`）。draftRequestId未指定なら
  // mount時に新規requestIdを発行するため、新規作成/追記を開くたびに常にまっさらな状態から始まる。
  // sending/complete中は保存しない（送信結果の確定待ち・完了画面のUI状態を上書きしないため）
  useEffect(() => {
    if (phase === 'sending' || phase === 'complete') return;
    if (!title && !content && !photoBase64 && !caption && type === '') return; // 空のまま保存しない
    void saveWorkLogDraft({
      requestId, mode, workId, title, type, content, datetime,
      photoBase64, photoMimeType: photoBase64 ? 'image/jpeg' : undefined, caption,
    }).catch(() => {
      // quota超過等でも無視（送信前に再入力できる）
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, workId, requestId, title, type, content, datetime, photoBase64, caption, phase]);

  // ── 写真選択 ─────────────────────────────────────────────
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setPhotoProcessing(true);
    try {
      const base64 = await resizeToJpeg(file);
      setPhotoBase64(base64);
      setPreviewUrl(`data:image/jpeg;base64,${base64}`);
    } catch (err) {
      alert(err instanceof Error ? err.message : '写真の処理に失敗しました');
    } finally {
      setPhotoProcessing(false);
      e.target.value = '';
    }
  };

  const removePhoto = () => {
    setPhotoBase64(undefined);
    setPreviewUrl('');
  };

  // ── バリデーション ────────────────────────────────────────
  const errors: string[] = [];
  if (mode === 'create' && !title.trim()) errors.push('タイトル');
  if (mode === 'create' && !type) errors.push('種別');
  if (!content.trim()) errors.push('内容');
  if (!datetime.trim()) errors.push('日時');
  const canProceed = errors.length === 0;

  // ── 送信 ─────────────────────────────────────────────────
  const send = async () => {
    if (!idToken) {
      handleTokenExpired();
      return;
    }
    setPhase('sending');

    // adapterが読むdraftを、送信直前の最新値で確実に確定させる（autosave effectとの競合を避ける保険）
    await saveWorkLogDraft({
      requestId, mode, workId, title, type, content, datetime,
      photoBase64, photoMimeType: photoBase64 ? 'image/jpeg' : undefined, caption,
    }).catch(() => {});

    const outcome = await submitWithFallback<WorkLogSubmissionPayload, WorkSubmitSuccess | undefined>({
      entity: 'workLog',
      itemId: requestId,
      payload: { requestId },
      title: mode === 'create' ? (title || '新しい作業') : `記録を追加: ${workId ?? ''}`,
      displayDate: datetime,
      idToken,
    });

    if (outcome.ok) {
      setOutcome({ kind: 'success', result: outcome.result });
    } else if (outcome.item.lastError?.retryable === false) {
      setOutcome({ kind: 'blocked', message: outcome.item.lastError.technicalDetail || outcome.item.lastError.description });
    } else {
      setOutcome({ kind: 'queued' });
    }
    setPhase('complete');
  };

  const startAnother = () => {
    setRequestId(crypto.randomUUID());
    setTitle(''); setType(''); setContent('');
    setDatetime(nowLocalDatetimeString());
    setPhotoBase64(undefined); setPreviewUrl(''); setCaption('');
    setOutcome(null);
    setPhase('form');
  };

  // ════════════════════════════════════════════════════════
  // RENDER
  // ════════════════════════════════════════════════════════

  if (authState !== 'ready') {
    return (
      <div className={styles.root}>
        <header className={styles.header}>
          <button className={styles.backBtn} onClick={() => go(backTarget)}>← 戻る</button>
          <span className={styles.headerTitle}>{mode === 'create' ? '新しい作業' : '記録を追加'}</span>
          <HomeButton go={go} />
        </header>
        <main className={styles.authMain}>
          <div className={styles.authCard}>
            {authState === 'signedOut' ? (
              <>
                <p className={styles.authLead}>Googleアカウントでログインしてください。</p>
                <div ref={signInContainerRef} className={styles.googleBtnWrap} />
              </>
            ) : (
              <p className={styles.authLead}>ログイン確認中…</p>
            )}
          </div>
        </main>
      </div>
    );
  }

  if (phase === 'form') {
    return (
      <div className={styles.root}>
        <header className={styles.header}>
          <button className={styles.backBtn} onClick={() => go(backTarget)}>← 戻る</button>
          <span className={styles.headerTitle}>{mode === 'create' ? '新しい作業' : `記録を追加${workTitle ? `: ${workTitle}` : ''}`}</span>
          <span className={styles.headerSub}>{userEmail.split('@')[0]}</span>
          <HomeButton go={go} />
        </header>

        <main className={styles.formMain}>
          {mode === 'create' && (
            <label className={styles.fieldLabel}>
              タイトル <span className={styles.required}>*</span>
              <input
                type="text"
                className={styles.textInput}
                placeholder="例: 山ぶどう酵母起こし"
                value={title}
                onChange={e => setTitle(e.target.value)}
              />
            </label>
          )}

          {mode === 'create' && (
            <label className={styles.fieldLabel}>
              種別 <span className={styles.required}>*</span>
              <select className={styles.selectInput} value={type} onChange={e => setType(e.target.value)}>
                <option value="">選択してください</option>
                {WORK_TYPE_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
              </select>
            </label>
          )}

          <label className={styles.fieldLabel}>
            内容 <span className={styles.required}>*</span>
            <textarea
              className={styles.textarea}
              placeholder="観察・作業内容など"
              value={content}
              onChange={e => setContent(e.target.value)}
              rows={4}
            />
          </label>

          <label className={styles.fieldLabel}>
            日時 <span className={styles.required}>*</span>
            <input
              type="datetime-local"
              className={styles.textInput}
              value={datetime}
              onChange={e => setDatetime(e.target.value)}
            />
          </label>

          <label className={styles.fieldLabel}>
            写真
            {previewUrl ? (
              <div className={styles.photoPreviewWrap}>
                <img src={previewUrl} alt="" className={styles.photoPreview} />
                <button className={styles.photoRemoveBtn} onClick={removePhoto}>✕ 削除</button>
              </div>
            ) : (
              <button
                className={styles.photoAddBtn}
                onClick={() => fileInputRef.current?.click()}
                disabled={photoProcessing}
              >
                {photoProcessing ? '処理中…' : '📷 写真を選ぶ'}
              </button>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className={styles.hidden}
              onChange={handleFileChange}
            />
          </label>

          {previewUrl && (
            <label className={styles.fieldLabel}>
              キャプション
              <input
                type="text"
                className={styles.textInput}
                placeholder="写真の説明"
                value={caption}
                onChange={e => setCaption(e.target.value)}
              />
            </label>
          )}
        </main>

        <footer className={styles.footer}>
          <button className={styles.primaryBtn} disabled={!canProceed} onClick={() => setPhase('confirm')}>
            確認へ →
          </button>
          {errors.length > 0 && <p className={styles.footerHint}>未入力: {errors.join('・')}</p>}
        </footer>
      </div>
    );
  }

  if (phase === 'confirm') {
    return (
      <div className={styles.root}>
        <header className={styles.header}>
          <button className={styles.backBtn} onClick={() => setPhase('form')}>← 修正する</button>
          <span className={styles.headerTitle}>送信内容の確認</span>
          <HomeButton go={go} />
        </header>
        <main className={styles.confirmMain}>
          <dl className={styles.confirmList}>
            {mode === 'create' && (<><dt>タイトル</dt><dd>{title}</dd></>)}
            {mode === 'create' && (<><dt>種別</dt><dd>{type}</dd></>)}
            {mode === 'append' && (<><dt>作業</dt><dd>{workTitle || workId}</dd></>)}
            <dt>内容</dt> <dd>{content}</dd>
            <dt>日時</dt> <dd>{datetime.replace('T', ' ')}</dd>
            {caption && (<><dt>キャプション</dt><dd>{caption}</dd></>)}
          </dl>
          {previewUrl && <img src={previewUrl} alt="" className={styles.confirmPhoto} />}
        </main>
        <footer className={styles.footer}>
          <button className={styles.primaryBtn} onClick={send}>送信する</button>
        </footer>
      </div>
    );
  }

  if (phase === 'sending') {
    return (
      <div className={styles.root}>
        <header className={styles.header}><span className={styles.headerTitle}>送信中…</span></header>
        <main className={styles.centeredMain}>
          <div className={styles.spinner} />
          <p className={styles.sendingText}>送信しています…</p>
        </main>
      </div>
    );
  }

  // ── 完了 ──────────────────────────────────────────────────
  if (phase === 'complete' && outcome) {
    if (outcome.kind === 'success') {
      const replayed = outcome.result?.code === 'ALREADY_PROCESSED';
      return (
        <div className={styles.root}>
          <header className={styles.header}>
            <span className={styles.headerTitle}>送信完了</span>
            <HomeButton go={go} />
          </header>
          <main className={styles.completeMain}>
            <div className={styles.successIcon}>✓</div>
            <p className={styles.successText}>
              {mode === 'create' ? '新しい作業を記録しました' : '記録を追加しました'}
              {replayed && '（再送・重複なし）'}
            </p>
            <button className={styles.primaryBtn} onClick={startAnother}>続けて記録する</button>
            {outcome.result && (
              <button
                className={styles.secondaryBtn}
                onClick={() => go({ name: 'workDetail', workId: outcome.result!.workId })}
              >
                作業詳細を見る
              </button>
            )}
            <button className={styles.secondaryBtn} onClick={() => go({ name: 'processing' })}>一覧へ戻る</button>
          </main>
        </div>
      );
    }

    if (outcome.kind === 'queued') {
      return (
        <div className={styles.root}>
          <header className={styles.header}><span className={styles.headerTitle}>保存しました</span><HomeButton go={go} /></header>
          <main className={styles.completeMain}>
            <div className={styles.warnIcon}>…</div>
            <p className={styles.successText}>
              この端末に保存しました<br />
              送信を待っています
            </p>
            <p className={styles.footerHint}>通信が戻ると自動で再送します。</p>
            <button className={styles.primaryBtn} onClick={startAnother}>新しい作業を記録する</button>
            <button className={styles.secondaryBtn} onClick={() => go({ name: 'pendingList' })}>保留中一覧へ</button>
            <button className={styles.secondaryBtn} onClick={() => go({ name: 'processing' })}>一覧へ戻る</button>
          </main>
        </div>
      );
    }

    return (
      <div className={styles.root}>
        <header className={styles.header}><span className={styles.headerTitle}>送信できませんでした</span><HomeButton go={go} /></header>
        <main className={styles.completeMain}>
          <div className={styles.warnIcon}>!</div>
          <p className={styles.successText}>{outcome.message}</p>
          <button className={styles.primaryBtn} onClick={send}>再送する</button>
          <button className={styles.secondaryBtn} onClick={() => setPhase('form')}>内容を修正する</button>
          <button className={styles.secondaryBtn} onClick={() => go(backTarget)}>一覧へ戻る</button>
        </main>
      </div>
    );
  }

  return null;
}
