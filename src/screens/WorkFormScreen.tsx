import { useEffect, useRef, useState } from 'react';
import { requestSilentIdToken, renderSignInButton } from '../api/googleAuth';
import { resizeToJpeg, TokenExpiredError, NetworkUnknownError } from '../api/icarusApi';
import { submitWork, WorkProcessingError } from '../api/workApi';
import { WORK_TYPE_OPTIONS, nowLocalDatetimeString, type WorkFormMode, type WorkSubmitSuccess } from '../types/workLog';
import type { Screen } from '../App';
import styles from './WorkFormScreen.module.css';

type Phase = 'auth' | 'form' | 'confirm' | 'sending' | 'complete';
type SendOutcome =
  | { kind: 'success'; result: WorkSubmitSuccess }
  | { kind: 'processing'; message: string }
  | { kind: 'error'; message: string };

type Props = {
  go: (s: Screen) => void;
  mode: WorkFormMode;
  workId?: string;
  workTitle?: string;
};

export default function WorkFormScreen({ go, mode, workId, workTitle }: Props) {
  const [phase, setPhase] = useState<Phase>('auth');
  const [idToken, setIdToken] = useState('');
  const [userEmail, setUserEmail] = useState('');
  const [signInEl, setSignInEl] = useState<HTMLDivElement | null>(null);
  const [authError, setAuthError] = useState('');

  const [requestId, setRequestId] = useState<string>(() => crypto.randomUUID());
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

  const backTarget: Screen = mode === 'append' && workId
    ? { name: 'workDetail', workId }
    : { name: 'processing' };

  // ── Google Sign-In（サイレント → ボタン） ────────────────
  useEffect(() => {
    if (phase !== 'auth') return;
    let cancelled = false;

    const afterAuth = async (token: string) => {
      if (cancelled) return;
      setIdToken(token);
      try {
        const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
        if (typeof payload.email === 'string') setUserEmail(payload.email);
      } catch { /* ignore */ }
      setPhase('form');
    };

    requestSilentIdToken().then((token) => {
      if (cancelled) return;
      if (token) void afterAuth(token);
    });

    return () => { cancelled = true; };
  }, [phase, mode, workId]);

  useEffect(() => {
    if (phase !== 'auth' || !signInEl) return;
    void renderSignInButton(signInEl, (token) => {
      setAuthError('');
      void (async () => {
        setIdToken(token);
        try {
          const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
          if (typeof payload.email === 'string') setUserEmail(payload.email);
        } catch { /* ignore */ }
        setPhase('form');
      })();
    });
  }, [phase, signInEl]);

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
    setPhase('sending');
    try {
      const isoDatetime = new Date(datetime).toISOString();
      const result = await submitWork({
        requestId,
        action: mode,
        workId: mode === 'append' ? workId : undefined,
        title: mode === 'create' ? title : undefined,
        type: mode === 'create' ? type : undefined,
        content,
        datetime: isoDatetime,
        photoBase64,
        photoMimeType: photoBase64 ? 'image/jpeg' : undefined,
        caption: caption || undefined,
      }, idToken);
      setOutcome({ kind: 'success', result });
    } catch (err) {
      if (err instanceof TokenExpiredError) {
        setIdToken(''); setUserEmail('');
        setAuthError(err.message);
        setPhase('auth');
        return;
      }
      if (err instanceof WorkProcessingError) {
        setOutcome({ kind: 'processing', message: err.message });
      } else {
        setOutcome({
          kind: 'error',
          message: err instanceof NetworkUnknownError ? err.message : err instanceof Error ? err.message : '送信に失敗しました',
        });
      }
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

  if (phase === 'auth') {
    return (
      <div className={styles.root}>
        <header className={styles.header}>
          <button className={styles.backBtn} onClick={() => go(backTarget)}>← 戻る</button>
          <span className={styles.headerTitle}>{mode === 'create' ? '新しい作業' : '記録を追加'}</span>
        </header>
        <main className={styles.authMain}>
          <div className={styles.authCard}>
            {authError && <p className={styles.errorBanner}>{authError}</p>}
            <p className={styles.authLead}>Googleアカウントでログインしてください。</p>
            <div ref={setSignInEl} className={styles.googleBtnWrap} />
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
      const replayed = outcome.result.code === 'ALREADY_PROCESSED';
      return (
        <div className={styles.root}>
          <header className={styles.header}>
            <span className={styles.headerTitle}>送信完了</span>
          </header>
          <main className={styles.completeMain}>
            <div className={styles.successIcon}>✓</div>
            <p className={styles.successText}>
              {mode === 'create' ? '新しい作業を記録しました' : '記録を追加しました'}
              {replayed && '（再送・重複なし）'}
            </p>
            <button className={styles.primaryBtn} onClick={startAnother}>続けて記録する</button>
            <button
              className={styles.secondaryBtn}
              onClick={() => go({ name: 'workDetail', workId: outcome.result.workId })}
            >
              作業詳細を見る
            </button>
            <button className={styles.secondaryBtn} onClick={() => go({ name: 'processing' })}>一覧へ戻る</button>
          </main>
        </div>
      );
    }

    if (outcome.kind === 'processing') {
      return (
        <div className={styles.root}>
          <header className={styles.header}><span className={styles.headerTitle}>処理中です</span></header>
          <main className={styles.completeMain}>
            <div className={styles.warnIcon}>…</div>
            <p className={styles.successText}>{outcome.message}</p>
            <button className={styles.primaryBtn} onClick={() => setPhase('confirm')}>戻ってしばらくしてから再送する</button>
            <button className={styles.secondaryBtn} onClick={() => go(backTarget)}>一覧へ戻る</button>
          </main>
        </div>
      );
    }

    return (
      <div className={styles.root}>
        <header className={styles.header}><span className={styles.headerTitle}>送信失敗</span></header>
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
