import { useEffect, useRef, useState } from 'react';
import { GOOGLE_CLIENT_ID } from '../config';
import { submitFoodLog, resizeToJpeg, TokenExpiredError } from '../api/icarusApi';
import {
  emptyForm,
  LARGE_CATEGORY_OPTIONS,
  PHASE_OPTIONS,
  HARVESTED_OPTIONS,
  type FoodLogForm,
  type FoodLogSuccess,
} from '../types/foodLog';
import type { Screen } from '../App';
import styles from './FoodLogScreen.module.css';

type Phase = 'auth' | 'form' | 'confirm' | 'sending' | 'success' | 'error';

type Props = { go: (s: Screen) => void };

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (config: {
            client_id: string;
            callback: (res: { credential: string }) => void;
            auto_select?: boolean;
          }) => void;
          renderButton: (el: HTMLElement, config: object) => void;
          disableAutoSelect: () => void;
        };
      };
    };
  }
}

function decodeJwtEmail(token: string): string {
  try {
    const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    return typeof payload.email === 'string' ? payload.email : '';
  } catch {
    return '';
  }
}

export default function FoodLogScreen({ go }: Props) {
  const [phase, setPhase] = useState<Phase>('auth');
  const [idToken, setIdToken] = useState('');
  const [userEmail, setUserEmail] = useState('');
  const [form, setForm] = useState<FoodLogForm>(emptyForm);
  const [photoProcessing, setPhotoProcessing] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [result, setResult] = useState<FoodLogSuccess | null>(null);
  const requestIdRef = useRef<string | null>(null);
  const googleBtnRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Google Sign-In の初期化
  useEffect(() => {
    if (phase !== 'auth') return;

    const init = () => {
      if (!window.google) return;
      window.google.accounts.id.initialize({
        client_id: GOOGLE_CLIENT_ID,
        callback: (res) => {
          const email = decodeJwtEmail(res.credential);
          setIdToken(res.credential);
          setUserEmail(email);
          setPhase('form');
        },
        auto_select: false,
      });
      if (googleBtnRef.current) {
        window.google.accounts.id.renderButton(googleBtnRef.current, {
          type: 'standard',
          text: 'signin_with',
          size: 'large',
          locale: 'ja',
          width: 280,
        });
      }
    };

    if (window.google) {
      init();
    } else {
      const scriptId = 'gsi-script';
      if (!document.getElementById(scriptId)) {
        const s = document.createElement('script');
        s.id = scriptId;
        s.src = 'https://accounts.google.com/gsi/client';
        s.async = true;
        s.defer = true;
        s.onload = init;
        document.body.appendChild(s);
      }
    }
  }, [phase]);

  // 写真選択
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setPhotoProcessing(true);
    try {
      const previewUrl = URL.createObjectURL(file);
      const base64 = await resizeToJpeg(file);
      setForm(f => ({ ...f, photoFile: file, photoPreviewUrl: previewUrl, photoBase64: base64 }));
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : '写真の処理に失敗しました');
    } finally {
      setPhotoProcessing(false);
      e.target.value = '';
    }
  };

  // フォーム変更
  const set = <K extends keyof FoodLogForm>(key: K, val: FoodLogForm[K]) =>
    setForm(f => ({ ...f, [key]: val }));

  // バリデーション
  const formErrors = (): string[] => {
    const errs: string[] = [];
    if (!form.food.trim())         errs.push('食材名');
    if (!form.largeCategory)       errs.push('大分類');
    if (!form.phase)               errs.push('フェーズ');
    if (!form.place.trim())        errs.push('場所');
    if (!form.photoBase64)         errs.push('写真');
    return errs;
  };

  // 確認画面へ
  const goConfirm = () => {
    const errs = formErrors();
    if (errs.length > 0) {
      setErrorMsg(`未入力項目があります: ${errs.join('、')}`);
      return;
    }
    setErrorMsg('');
    if (!requestIdRef.current) {
      requestIdRef.current = crypto.randomUUID();
    }
    setPhase('confirm');
  };

  // 送信
  const send = async () => {
    if (!requestIdRef.current) return;
    setPhase('sending');
    try {
      const res = await submitFoodLog(form, requestIdRef.current, idToken);
      setResult(res);
      setPhase('success');
    } catch (err) {
      if (err instanceof TokenExpiredError) {
        setIdToken('');
        setUserEmail('');
        setPhase('auth');
        setErrorMsg(err.message);
        return;
      }
      setErrorMsg(err instanceof Error ? err.message : '送信に失敗しました');
      setPhase('error');
    }
  };

  // 再試行（同じ requestId）
  const retry = () => {
    setErrorMsg('');
    setPhase('confirm');
  };

  // 新規フォームへリセット
  const reset = () => {
    setForm(emptyForm());
    requestIdRef.current = null;
    setResult(null);
    setErrorMsg('');
    setPhase('form');
  };

  // サインアウト
  const signOut = () => {
    window.google?.accounts.id.disableAutoSelect();
    setIdToken('');
    setUserEmail('');
    setPhase('auth');
    setForm(emptyForm());
    requestIdRef.current = null;
  };

  // ── 認証画面 ──────────────────────────────────────────────────
  if (phase === 'auth') {
    return (
      <div className={styles.root}>
        <header className={styles.header}>
          <button className={styles.backBtn} onClick={() => go({ name: 'home' })}>← 戻る</button>
          <span className={styles.headerTitle}>食材ログ</span>
        </header>
        <main className={styles.authMain}>
          <div className={styles.authCard}>
            <p className={styles.authLead}>送信するにはGoogleアカウントでログインしてください。</p>
            {errorMsg && <p className={styles.errorBanner}>{errorMsg}</p>}
            <div ref={googleBtnRef} className={styles.googleBtnWrap} />
          </div>
        </main>
      </div>
    );
  }

  // ── 送信中 ───────────────────────────────────────────────────
  if (phase === 'sending') {
    return (
      <div className={styles.root}>
        <header className={styles.header}>
          <span className={styles.headerTitle}>送信中…</span>
        </header>
        <main className={styles.centeredMain}>
          <div className={styles.spinner} />
          <p className={styles.sendingText}>Cloudinaryへ写真を保存し、Sheetsへ記録しています</p>
        </main>
      </div>
    );
  }

  // ── 成功 ────────────────────────────────────────────────────
  if (phase === 'success' && result) {
    return (
      <div className={styles.root}>
        <header className={styles.header}>
          <button className={styles.backBtn} onClick={() => go({ name: 'home' })}>← ホーム</button>
          <span className={styles.headerTitle}>送信完了</span>
        </header>
        <main className={styles.centeredMain}>
          <div className={styles.successIcon}>✓</div>
          <p className={styles.successFood}>{result.food}</p>
          <p className={styles.successSub}>を記録しました{result.replayed ? '（送信済みのデータを確認しました）' : ''}</p>
          {result.photoUrl && (
            <img src={result.photoUrl} alt={result.food} className={styles.successPhoto} />
          )}
          <p className={styles.successMeta}>行 {result.row} / EventID: {result.eventId.slice(0, 8)}…</p>
          <button className={styles.primaryBtn} onClick={reset}>続けて記録する</button>
          <button className={styles.secondaryBtn} onClick={() => go({ name: 'home' })}>ホームへ戻る</button>
        </main>
      </div>
    );
  }

  // ── エラー ───────────────────────────────────────────────────
  if (phase === 'error') {
    return (
      <div className={styles.root}>
        <header className={styles.header}>
          <button className={styles.backBtn} onClick={() => setPhase('form')}>← フォームへ</button>
          <span className={styles.headerTitle}>送信エラー</span>
        </header>
        <main className={styles.centeredMain}>
          <p className={styles.errorIcon}>!</p>
          <p className={styles.errorDetail}>{errorMsg}</p>
          <p className={styles.errorSub}>同じ内容で再送できます（重複送信は自動防止されます）</p>
          <button className={styles.primaryBtn} onClick={retry}>もう一度送信する</button>
          <button className={styles.secondaryBtn} onClick={() => setPhase('form')}>内容を修正する</button>
        </main>
      </div>
    );
  }

  // ── 確認画面 ─────────────────────────────────────────────────
  if (phase === 'confirm') {
    return (
      <div className={styles.root}>
        <header className={styles.header}>
          <button className={styles.backBtn} onClick={() => setPhase('form')}>← 修正する</button>
          <span className={styles.headerTitle}>送信内容の確認</span>
        </header>
        <main className={styles.confirmMain}>
          {form.photoPreviewUrl && (
            <img src={form.photoPreviewUrl} alt="" className={styles.confirmPhoto} />
          )}
          <dl className={styles.confirmList}>
            <dt>日付</dt>    <dd>{form.date}</dd>
            <dt>食材名</dt>  <dd>{form.food}</dd>
            <dt>大分類</dt>  <dd>{form.largeCategory}</dd>
            <dt>フェーズ</dt><dd>{form.phase}</dd>
            <dt>場所</dt>    <dd>{form.place}</dd>
            <dt>採取</dt>    <dd>{form.harvested}</dd>
            {form.memo && <><dt>メモ</dt><dd>{form.memo}</dd></>}
          </dl>
          <p className={styles.reqIdNote}>requestId: {requestIdRef.current?.slice(0, 8)}…</p>
        </main>
        <footer className={styles.footer}>
          <button className={styles.primaryBtn} onClick={send}>送信する</button>
        </footer>
      </div>
    );
  }

  // ── フォーム ─────────────────────────────────────────────────
  return (
    <div className={styles.root}>
      <header className={styles.header}>
        <button className={styles.backBtn} onClick={() => go({ name: 'home' })}>← 戻る</button>
        <span className={styles.headerTitle}>食材ログ</span>
        <button className={styles.signOutBtn} onClick={signOut} title={userEmail}>
          {userEmail.split('@')[0]}
        </button>
      </header>

      <main className={styles.formMain}>
        {errorMsg && <p className={styles.errorBanner}>{errorMsg}</p>}

        {/* 写真 */}
        <section className={styles.photoSection}>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            className={styles.hidden}
            onChange={handleFileChange}
          />
          <button
            className={styles.photoBtn}
            onClick={() => fileInputRef.current?.click()}
            disabled={photoProcessing}
          >
            {photoProcessing ? (
              <span>処理中…</span>
            ) : form.photoPreviewUrl ? (
              <img src={form.photoPreviewUrl} alt="" className={styles.photoPreview} />
            ) : (
              <span className={styles.photoPlaceholder}>📷 写真を選択（必須）</span>
            )}
          </button>
          {form.photoPreviewUrl && (
            <button className={styles.photoChange} onClick={() => fileInputRef.current?.click()}>
              写真を変更
            </button>
          )}
        </section>

        {/* 日付 */}
        <label className={styles.fieldLabel}>
          日付
          <input
            type="date"
            className={styles.textInput}
            value={form.date}
            onChange={e => set('date', e.target.value)}
          />
        </label>

        {/* 食材名 */}
        <label className={styles.fieldLabel}>
          食材名 <span className={styles.required}>*</span>
          <input
            type="text"
            className={styles.textInput}
            placeholder="例: ウド、行者ニンニク"
            value={form.food}
            onChange={e => set('food', e.target.value)}
          />
        </label>

        {/* 大分類 */}
        <label className={styles.fieldLabel}>
          大分類 <span className={styles.required}>*</span>
          <select
            className={styles.selectInput}
            value={form.largeCategory}
            onChange={e => set('largeCategory', e.target.value)}
          >
            <option value="">選択してください</option>
            {LARGE_CATEGORY_OPTIONS.map(o => (
              <option key={o} value={o}>{o}</option>
            ))}
          </select>
        </label>

        {/* フェーズ */}
        <label className={styles.fieldLabel}>
          フェーズ <span className={styles.required}>*</span>
          <select
            className={styles.selectInput}
            value={form.phase}
            onChange={e => set('phase', e.target.value)}
          >
            <option value="">選択してください</option>
            {PHASE_OPTIONS.map(o => (
              <option key={o} value={o}>{o}</option>
            ))}
          </select>
        </label>

        {/* 場所 */}
        <label className={styles.fieldLabel}>
          場所 <span className={styles.required}>*</span>
          <input
            type="text"
            className={styles.textInput}
            placeholder="例: なな山、余市川"
            value={form.place}
            onChange={e => set('place', e.target.value)}
          />
        </label>

        {/* 採取有無 */}
        <fieldset className={styles.fieldset}>
          <legend className={styles.fieldLabel}>採取有無</legend>
          <div className={styles.segmented}>
            {HARVESTED_OPTIONS.map(o => (
              <label key={o} className={`${styles.segItem} ${form.harvested === o ? styles.segActive : ''}`}>
                <input
                  type="radio"
                  name="harvested"
                  value={o}
                  checked={form.harvested === o}
                  onChange={() => set('harvested', o)}
                  className={styles.hidden}
                />
                {o}
              </label>
            ))}
          </div>
        </fieldset>

        {/* メモ */}
        <label className={styles.fieldLabel}>
          メモ
          <textarea
            className={styles.textarea}
            placeholder="気づき、状態、場所の詳細など"
            value={form.memo}
            onChange={e => set('memo', e.target.value)}
            rows={3}
          />
        </label>
      </main>

      <footer className={styles.footer}>
        <button className={styles.primaryBtn} onClick={goConfirm}>
          送信内容を確認 →
        </button>
      </footer>
    </div>
  );
}
