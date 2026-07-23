import { useCallback, useEffect, useRef, useState } from 'react';
import { GOOGLE_CLIENT_ID } from '../config';
import {
  submitPhotoEntry, resizeToJpeg, fetchGps, fetchFoodCandidates,
  extractExifDate, TokenExpiredError,
} from '../api/icarusApi';
import {
  emptyCommonFields,
  emptyPhotoEntry,
  todayString,
  LARGE_CATEGORY_OPTIONS,
  PHASE_OPTIONS,
  HARVESTED_OPTIONS,
  MAX_PHOTOS,
  type PhotoEntry,
  type CommonFields,
  type FoodCandidate,
  type PhotoSendResult,
  type SubmitMode,
} from '../types/foodLog';
import { saveFoodLogDraft, loadFoodLogDraft, clearFoodLogDraft } from '../db/localDB';
import type { Screen } from '../App';
import styles from './FoodLogScreen.module.css';

type Phase = 'auth' | 'photoSelect' | 'photoEdit' | 'confirm' | 'sending' | 'complete';

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

  const [photos, setPhotos] = useState<PhotoEntry[]>([]);
  const [common, setCommon] = useState<CommonFields>(emptyCommonFields());
  const [submitMode, setSubmitMode] = useState<SubmitMode>('batch');
  const [currentIdx, setCurrentIdx] = useState(0);

  const [sendResults, setSendResults] = useState<PhotoSendResult[]>([]);
  const [foodCandidates, setFoodCandidates] = useState<FoodCandidate[]>([]);
  const [candidateQuery, setCandidateQuery] = useState('');
  const [showDropdown, setShowDropdown] = useState(false);
  const [gpsLoading, setGpsLoading] = useState(false);
  const [photoProcessing, setPhotoProcessing] = useState(false);
  const [authError, setAuthError] = useState('');
  const [draftRestored, setDraftRestored] = useState(false);

  const googleBtnRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── 下書き保存 ───────────────────────────────────────────
  const saveDraft = useCallback(async (p: PhotoEntry[], c: CommonFields, mode: SubmitMode, idx: number) => {
    if (p.length === 0) return;
    try {
      await saveFoodLogDraft({
        photos: p.map(({ previewUrl: _, ...rest }) => rest),
        commonFields: c,
        submitMode: mode,
        currentPhotoIndex: idx,
      });
    } catch {
      // quota 超過などでも無視（送信前に再入力できる）
    }
  }, []);

  useEffect(() => {
    if (phase !== 'auth' && phase !== 'sending' && phase !== 'complete') {
      void saveDraft(photos, common, submitMode, currentIdx);
    }
  }, [photos, common, submitMode, currentIdx, phase, saveDraft]);

  // ── Google Sign-In ───────────────────────────────────────
  useEffect(() => {
    if (phase !== 'auth') return;

    const init = () => {
      if (!window.google) return;
      window.google.accounts.id.initialize({
        client_id: GOOGLE_CLIENT_ID,
        callback: async (res) => {
          setIdToken(res.credential);
          setUserEmail(decodeJwtEmail(res.credential));
          fetchFoodCandidates().then(setFoodCandidates);

          const draft = await loadFoodLogDraft();
          if (draft && draft.photos.length > 0) {
            setPhotos(draft.photos.map(p => ({
              ...p,
              previewUrl: p.base64 ? `data:image/jpeg;base64,${p.base64}` : '',
            })));
            setCommon(draft.commonFields);
            setSubmitMode(draft.submitMode ?? 'batch');
            setCurrentIdx(draft.currentPhotoIndex);
            setDraftRestored(true);
          }
          setPhase('photoSelect');
        },
        auto_select: false,
      });
      if (googleBtnRef.current) {
        window.google.accounts.id.renderButton(googleBtnRef.current, {
          type: 'standard', text: 'signin_with', size: 'large', locale: 'ja', width: 280,
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

  // ── 写真追加（EXIF 日付自動抽出） ─────────────────────────
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;
    const remaining = MAX_PHOTOS - photos.length;
    const toProcess = files.slice(0, remaining);
    setPhotoProcessing(true);
    try {
      // このバッチで追加する写真は同じ場所で撮ったものとみなし、GPSは1回だけ取得して全員に適用する
      const gps = await fetchGps();
      const newEntries = await Promise.all(
        toProcess.map(async (file) => {
          const [base64, exif] = await Promise.all([
            resizeToJpeg(file),
            extractExifDate(file),
          ]);
          const entry = emptyPhotoEntry();
          return {
            ...entry,
            base64,
            previewUrl: `data:image/jpeg;base64,${base64}`,
            date: exif?.date ?? '',
            takenAt: exif?.takenAt,
            gps: gps ?? undefined,
          };
        }),
      );
      setPhotos(prev => [...prev, ...newEntries]);
    } catch (err) {
      alert(err instanceof Error ? err.message : '写真の処理に失敗しました');
    } finally {
      setPhotoProcessing(false);
      e.target.value = '';
    }
  };

  const removePhoto = (localId: string) => {
    setPhotos(prev => {
      const next = prev.filter(p => p.localId !== localId);
      if (currentIdx >= next.length && currentIdx > 0) setCurrentIdx(next.length - 1);
      return next;
    });
  };

  const updatePhoto = <K extends keyof PhotoEntry>(localId: string, key: K, val: PhotoEntry[K]) =>
    setPhotos(prev => prev.map(p => p.localId === localId ? { ...p, [key]: val } : p));

  // ── GPS ─────────────────────────────────────────────────
  const handleGetGps = async (localId: string) => {
    setGpsLoading(true);
    try {
      const gps = await fetchGps();
      if (gps) updatePhoto(localId, 'gps', gps);
      else alert('GPS を取得できませんでした（位置情報を許可してください）');
    } finally {
      setGpsLoading(false);
    }
  };

  // ── バリデーション ────────────────────────────────────────
  const commonErrors = (): string[] => {
    if (submitMode === 'individual') return []; // 一件ずつ送信では各写真側でチェックする
    const errs: string[] = [];
    if (!common.largeCategory) errs.push('大分類');
    if (!common.place.trim())  errs.push('場所');
    return errs;
  };

  const photoErrors = (p: PhotoEntry): string[] => {
    const errs: string[] = [];
    if (!p.food.trim()) errs.push('食材名');
    if (!p.phase)       errs.push('フェーズ');
    if (!p.base64)      errs.push('写真');
    if (submitMode === 'individual') {
      if (!p.largeCategory) errs.push('大分類');
      if (!(p.place ?? '').trim()) errs.push('場所');
    }
    return errs;
  };

  const allPhotoErrors = () =>
    photos.flatMap((p, i) => photoErrors(p).map(e => `写真${i + 1}: ${e}`));

  // 送信時に使う共通項目。一件ずつ送信では、その写真自身の値を使う。
  const commonFieldsFor = (p: PhotoEntry): CommonFields =>
    submitMode === 'individual'
      ? { largeCategory: p.largeCategory ?? '', place: p.place ?? '', harvested: p.harvested ?? '不明' }
      : common;

  // ── 送信 ─────────────────────────────────────────────────
  const startSend = async () => {
    setPhase('sending');
    const results: PhotoSendResult[] = photos.map((_, i) => ({ photoIndex: i, status: 'pending' }));
    setSendResults([...results]);

    for (let i = 0; i < photos.length; i++) {
      results[i] = { ...results[i], status: 'sending' };
      setSendResults([...results]);
      try {
        const res = await submitPhotoEntry(photos[i], commonFieldsFor(photos[i]), idToken);
        results[i] = { ...results[i], status: 'success', result: res };
      } catch (err) {
        if (err instanceof TokenExpiredError) {
          setIdToken('');
          setUserEmail('');
          setPhase('auth');
          setAuthError(err.message);
          return;
        }
        results[i] = { ...results[i], status: 'error', error: err instanceof Error ? err.message : '送信に失敗しました' };
      }
      setSendResults([...results]);
    }

    await clearFoodLogDraft();
    setPhase('complete');
  };

  const reset = () => {
    setPhotos([]);
    setCommon(emptyCommonFields());
    setSubmitMode('batch');
    setCurrentIdx(0);
    setSendResults([]);
    setDraftRestored(false);
    setPhase('photoSelect');
  };

  const signOut = () => {
    window.google?.accounts.id.disableAutoSelect();
    setIdToken(''); setUserEmail('');
    setPhotos([]); setCommon(emptyCommonFields());
    setSubmitMode('batch');
    setCurrentIdx(0); setDraftRestored(false);
    void clearFoodLogDraft();
    setPhase('auth');
  };

  // ── 食材候補フィルター ─────────────────────────────────────
  const filteredCandidates = candidateQuery.length > 0
    ? foodCandidates.filter(c => c.name.toLowerCase().includes(candidateQuery.toLowerCase())).slice(0, 8)
    : [];

  // ════════════════════════════════════════════════════════
  // RENDER
  // ════════════════════════════════════════════════════════

  // ── 認証 ─────────────────────────────────────────────────
  if (phase === 'auth') {
    return (
      <div className={styles.root}>
        <header className={styles.header}>
          <button className={styles.backBtn} onClick={() => go({ name: 'home' })}>← 戻る</button>
          <span className={styles.headerTitle}>食材ログ</span>
        </header>
        <main className={styles.authMain}>
          <div className={styles.authCard}>
            <p className={styles.authLead}>Googleアカウントでログインしてください。</p>
            {authError && <p className={styles.errorBanner}>{authError}</p>}
            <div ref={googleBtnRef} className={styles.googleBtnWrap} />
          </div>
        </main>
      </div>
    );
  }

  // ── 写真選択 ＋ 共通設定（統合画面） ─────────────────────
  if (phase === 'photoSelect') {
    const cErrs = commonErrors();
    const canProceed = photos.length > 0 && cErrs.length === 0;

    return (
      <div className={styles.root}>
        <header className={styles.header}>
          <button className={styles.backBtn} onClick={() => go({ name: 'home' })}>← 戻る</button>
          <span className={styles.headerTitle}>写真を選ぶ</span>
          <button className={styles.signOutBtn} onClick={signOut} title={userEmail}>
            {userEmail.split('@')[0]}
          </button>
        </header>

        <main className={styles.formMain}>
          {draftRestored && (
            <div className={styles.draftBanner}>
              下書きを復元しました（写真 {photos.length} 枚）
              <button className={styles.draftClearBtn} onClick={() => {
                void clearFoodLogDraft();
                setPhotos([]); setCommon(emptyCommonFields()); setDraftRestored(false);
              }}>破棄</button>
            </div>
          )}

          {/* 写真グリッド */}
          <div className={styles.photoGrid}>
            {photos.map((p, i) => (
              <div key={p.localId} className={styles.photoGridItem}>
                <img src={p.previewUrl} alt={`写真${i + 1}`} className={styles.photoGridImg} />
                <span className={styles.photoGridNum}>{i + 1}</span>
                <button className={styles.photoGridDel} onClick={() => removePhoto(p.localId)}>✕</button>
                {p.date && <span className={styles.photoGridDate}>{p.date.slice(5)}</span>}
              </div>
            ))}
            {photos.length < MAX_PHOTOS && (
              <button
                className={styles.photoAddBtn}
                onClick={() => fileInputRef.current?.click()}
                disabled={photoProcessing}
              >
                {photoProcessing ? '処理中…' : `📷 ${photos.length === 0 ? '写真を選ぶ' : '追加'}`}
              </button>
            )}
          </div>
          <p className={styles.photoHint}>最大 {MAX_PHOTOS} 枚 / 現在 {photos.length} 枚</p>

          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            className={styles.hidden}
            onChange={handleFileChange}
          />

          {/* 送信方法（写真が1枚以上あるときだけ表示） */}
          {photos.length > 0 && (
            <fieldset className={styles.fieldset}>
              <legend className={styles.fieldLabel}>送信方法</legend>
              <div className={styles.segmented}>
                <label className={`${styles.segItem} ${submitMode === 'batch' ? styles.segActive : ''}`}>
                  <input
                    type="radio"
                    name="submitMode"
                    checked={submitMode === 'batch'}
                    onChange={() => setSubmitMode('batch')}
                    className={styles.hidden}
                  />
                  まとめて送信
                </label>
                <label className={`${styles.segItem} ${submitMode === 'individual' ? styles.segActive : ''}`}>
                  <input
                    type="radio"
                    name="submitMode"
                    checked={submitMode === 'individual'}
                    onChange={() => setSubmitMode('individual')}
                    className={styles.hidden}
                  />
                  一件ずつ送信
                </label>
              </div>
              <p className={styles.photoHint}>
                {submitMode === 'batch'
                  ? '大分類・場所・採取有無を全ての写真に共通で使います'
                  : '大分類・場所・採取有無を写真ごとに個別に入力します（次の画面で入力）'}
              </p>
            </fieldset>
          )}

          {/* 共通設定（まとめて送信のときだけ表示） */}
          {photos.length > 0 && submitMode === 'batch' && (
            <div className={styles.commonSection}>
              <p className={styles.commonSectionTitle}>共通設定（全 {photos.length} 枚に適用）</p>

              <label className={styles.fieldLabel}>
                大分類 <span className={styles.required}>*</span>
                <select
                  className={styles.selectInput}
                  value={common.largeCategory}
                  onChange={e => setCommon(c => ({ ...c, largeCategory: e.target.value }))}
                >
                  <option value="">選択してください</option>
                  {LARGE_CATEGORY_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
                </select>
              </label>

              <label className={styles.fieldLabel}>
                場所 <span className={styles.required}>*</span>
                <input
                  type="text"
                  className={styles.textInput}
                  placeholder="例: なな山、余市川"
                  value={common.place}
                  onChange={e => setCommon(c => ({ ...c, place: e.target.value }))}
                />
              </label>

              <fieldset className={styles.fieldset}>
                <legend className={styles.fieldLabel}>採取有無</legend>
                <div className={styles.segmented}>
                  {HARVESTED_OPTIONS.map(o => (
                    <label key={o} className={`${styles.segItem} ${common.harvested === o ? styles.segActive : ''}`}>
                      <input
                        type="radio"
                        name="harvested"
                        value={o}
                        checked={common.harvested === o}
                        onChange={() => setCommon(c => ({ ...c, harvested: o }))}
                        className={styles.hidden}
                      />
                      {o}
                    </label>
                  ))}
                </div>
              </fieldset>
            </div>
          )}
        </main>

        <footer className={styles.footer}>
          <button
            className={styles.primaryBtn}
            disabled={!canProceed}
            onClick={() => { setCurrentIdx(0); setPhase('photoEdit'); }}
          >
            写真ごとの入力へ →
          </button>
          {photos.length > 0 && cErrs.length > 0 && (
            <p className={styles.footerHint}>未入力: {cErrs.join('・')}</p>
          )}
        </footer>
      </div>
    );
  }

  // ── 写真ごと編集 ──────────────────────────────────────────
  if (phase === 'photoEdit') {
    const photo = photos[currentIdx];
    const pErrs = photoErrors(photo);
    const allDone = allPhotoErrors().length === 0;

    return (
      <div className={styles.root}>
        <header className={styles.header}>
          <button className={styles.backBtn} onClick={() => setPhase('photoSelect')}>← 共通</button>
          <span className={styles.headerTitle}>写真ごとの入力</span>
          <button className={styles.signOutBtn} onClick={signOut} title={userEmail}>
            {userEmail.split('@')[0]}
          </button>
        </header>

        {/* サムネイルストリップ */}
        <div className={styles.thumbStrip}>
          {photos.map((p, i) => (
            <button
              key={p.localId}
              className={`${styles.thumbItem} ${i === currentIdx ? styles.thumbActive : ''}`}
              onClick={() => setCurrentIdx(i)}
            >
              <img src={p.previewUrl} alt={`写真${i + 1}`} className={styles.thumbImg} />
              {photoErrors(p).length > 0 && <span className={styles.thumbBadge}>!</span>}
              {photoErrors(p).length === 0 && p.food && <span className={styles.thumbOk}>✓</span>}
            </button>
          ))}
        </div>

        {/* ナビゲーション */}
        <div className={styles.photoNav}>
          <button className={styles.navBtn} onClick={() => setCurrentIdx(i => Math.max(0, i - 1))} disabled={currentIdx === 0}>← 前へ</button>
          <span className={styles.navCounter}>{currentIdx + 1} / {photos.length}</span>
          <button className={styles.navBtn} onClick={() => setCurrentIdx(i => Math.min(photos.length - 1, i + 1))} disabled={currentIdx === photos.length - 1}>次へ →</button>
        </div>

        <main className={styles.formMain}>
          <img src={photo.previewUrl} alt="" className={styles.editPhotoPreview} />

          {/* 日付（EXIF から自動入力） */}
          <label className={styles.fieldLabel}>
            日付
            {photo.date === '' && (
              <span className={styles.exifMissing}>EXIFなし — 手動入力</span>
            )}
            <div className={styles.dateRow}>
              <input
                type="date"
                className={styles.textInput}
                value={photo.date}
                onChange={e => updatePhoto(photo.localId, 'date', e.target.value)}
                placeholder="YYYY-MM-DD"
              />
              {photo.date === '' && (
                <button
                  className={styles.todayBtn}
                  onClick={() => updatePhoto(photo.localId, 'date', todayString())}
                >
                  今日
                </button>
              )}
            </div>
          </label>

          {/* 食材名（候補付き） */}
          <label className={styles.fieldLabel}>
            食材名 <span className={styles.required}>*</span>
            <div className={styles.autocompleteWrap}>
              <input
                type="text"
                className={styles.textInput}
                placeholder="例: ウド、行者ニンニク"
                value={photo.food}
                onChange={e => {
                  updatePhoto(photo.localId, 'food', e.target.value);
                  updatePhoto(photo.localId, 'foodId', undefined);
                  setCandidateQuery(e.target.value);
                  setShowDropdown(true);
                }}
                onFocus={() => { setCandidateQuery(photo.food); setShowDropdown(true); }}
                onBlur={() => setTimeout(() => setShowDropdown(false), 150)}
              />
              {showDropdown && filteredCandidates.length > 0 && (
                <ul className={styles.dropdown}>
                  {filteredCandidates.map(c => (
                    <li key={c.name} className={styles.dropdownItem} onMouseDown={() => {
                      updatePhoto(photo.localId, 'food', c.name);
                      updatePhoto(photo.localId, 'foodId', c.name);
                      setShowDropdown(false);
                      setCandidateQuery('');
                    }}>
                      <span className={styles.dropdownName}>{c.name}</span>
                      {c.category && <span className={styles.dropdownCat}>{c.category}</span>}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </label>

          {/* フェーズ */}
          <label className={styles.fieldLabel}>
            フェーズ <span className={styles.required}>*</span>
            <select className={styles.selectInput} value={photo.phase} onChange={e => updatePhoto(photo.localId, 'phase', e.target.value)}>
              <option value="">選択してください</option>
              {PHASE_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
            </select>
          </label>

          {/* 一件ずつ送信のときだけ、この写真専用の大分類・場所・採取有無 */}
          {submitMode === 'individual' && (
            <>
              <label className={styles.fieldLabel}>
                大分類 <span className={styles.required}>*</span>
                <select
                  className={styles.selectInput}
                  value={photo.largeCategory ?? ''}
                  onChange={e => updatePhoto(photo.localId, 'largeCategory', e.target.value)}
                >
                  <option value="">選択してください</option>
                  {LARGE_CATEGORY_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
                </select>
              </label>

              <label className={styles.fieldLabel}>
                場所 <span className={styles.required}>*</span>
                <input
                  type="text"
                  className={styles.textInput}
                  placeholder="例: なな山、余市川"
                  value={photo.place ?? ''}
                  onChange={e => updatePhoto(photo.localId, 'place', e.target.value)}
                />
              </label>

              <fieldset className={styles.fieldset}>
                <legend className={styles.fieldLabel}>採取有無</legend>
                <div className={styles.segmented}>
                  {HARVESTED_OPTIONS.map(o => (
                    <label key={o} className={`${styles.segItem} ${(photo.harvested ?? '不明') === o ? styles.segActive : ''}`}>
                      <input
                        type="radio"
                        name={`harvested-${photo.localId}`}
                        value={o}
                        checked={(photo.harvested ?? '不明') === o}
                        onChange={() => updatePhoto(photo.localId, 'harvested', o)}
                        className={styles.hidden}
                      />
                      {o}
                    </label>
                  ))}
                </div>
              </fieldset>
            </>
          )}

          {/* メモ */}
          <label className={styles.fieldLabel}>
            メモ
            <textarea
              className={styles.textarea}
              placeholder="気づき、状態など"
              value={photo.memo}
              onChange={e => updatePhoto(photo.localId, 'memo', e.target.value)}
              rows={3}
            />
          </label>

          {/* GPS */}
          <div className={styles.gpsRow}>
            <button className={styles.gpsBtn} onClick={() => handleGetGps(photo.localId)} disabled={gpsLoading}>
              {gpsLoading ? '取得中…' : photo.gps ? `📍 ${photo.gps.lat.toFixed(5)}, ${photo.gps.lng.toFixed(5)}` : '📍 GPS を取得'}
            </button>
            {photo.gps && <button className={styles.gpsClear} onClick={() => updatePhoto(photo.localId, 'gps', undefined)}>✕</button>}
          </div>

          {pErrs.length > 0 && <p className={styles.errorBanner}>未入力: {pErrs.join('・')}</p>}
        </main>

        <footer className={styles.footer}>
          {allDone ? (
            <button className={styles.primaryBtn} onClick={() => setPhase('confirm')}>確認へ →</button>
          ) : currentIdx < photos.length - 1 ? (
            <button className={styles.primaryBtn} onClick={() => setCurrentIdx(i => i + 1)}>次の写真へ →</button>
          ) : (
            <p className={styles.footerHint}>未入力の写真があります（サムネイルの「!」を確認）</p>
          )}
        </footer>
      </div>
    );
  }

  // ── 確認 ─────────────────────────────────────────────────
  if (phase === 'confirm') {
    return (
      <div className={styles.root}>
        <header className={styles.header}>
          <button className={styles.backBtn} onClick={() => setPhase('photoEdit')}>← 修正する</button>
          <span className={styles.headerTitle}>送信内容の確認</span>
        </header>
        <main className={styles.confirmMain}>
          {submitMode === 'batch' && (
            <dl className={styles.confirmCommon}>
              <dt>大分類</dt> <dd>{common.largeCategory}</dd>
              <dt>場所</dt>   <dd>{common.place}</dd>
              <dt>採取</dt>   <dd>{common.harvested}</dd>
            </dl>
          )}
          {photos.map((p, i) => (
            <div key={p.localId} className={styles.confirmPhoto}>
              <img src={p.previewUrl} alt="" className={styles.confirmThumb} />
              <div className={styles.confirmPhotoInfo}>
                <p className={styles.confirmPhotoNum}>写真 {i + 1} {p.date && `· ${p.date}`}</p>
                <p className={styles.confirmPhotoFood}>{p.food}</p>
                <p className={styles.confirmPhotoSub}>{p.phase}{p.memo ? ` / ${p.memo.slice(0, 20)}` : ''}</p>
                {submitMode === 'individual' && (
                  <p className={styles.confirmPhotoSub}>{p.largeCategory} · {p.place} · 採取{p.harvested ?? '不明'}</p>
                )}
                {p.gps && <p className={styles.confirmPhotoGps}>📍 GPS あり</p>}
              </div>
              <button className={styles.confirmEditBtn} onClick={() => { setCurrentIdx(i); setPhase('photoEdit'); }}>編集</button>
            </div>
          ))}
        </main>
        <footer className={styles.footer}>
          <button className={styles.primaryBtn} onClick={startSend}>{photos.length} 件を送信する</button>
        </footer>
      </div>
    );
  }

  // ── 送信中 ────────────────────────────────────────────────
  if (phase === 'sending') {
    const current = sendResults.find(r => r.status === 'sending');
    return (
      <div className={styles.root}>
        <header className={styles.header}><span className={styles.headerTitle}>送信中…</span></header>
        <main className={styles.centeredMain}>
          <div className={styles.spinner} />
          <p className={styles.sendingText}>
            {current ? `${current.photoIndex + 1} / ${photos.length} 枚目を送信中…` : '完了処理中…'}
          </p>
          <div className={styles.sendProgress}>
            {sendResults.map((r, i) => (
              <span key={i} className={`${styles.sendDot} ${
                r.status === 'success' ? styles.sendDotOk :
                r.status === 'error'   ? styles.sendDotErr :
                r.status === 'sending' ? styles.sendDotActive : ''
              }`} />
            ))}
          </div>
        </main>
      </div>
    );
  }

  // ── 完了 ──────────────────────────────────────────────────
  if (phase === 'complete') {
    const successCount = sendResults.filter(r => r.status === 'success').length;
    const errorCount   = sendResults.filter(r => r.status === 'error').length;
    return (
      <div className={styles.root}>
        <header className={styles.header}>
          <button className={styles.backBtn} onClick={() => go({ name: 'home' })}>← ホーム</button>
          <span className={styles.headerTitle}>送信完了</span>
        </header>
        <main className={styles.completeMain}>
          <div className={errorCount === 0 ? styles.successIcon : styles.warnIcon}>
            {errorCount === 0 ? '✓' : '!'}
          </div>
          <p className={styles.successFood}>
            {successCount} 件 記録しました{errorCount > 0 ? ` / ${errorCount} 件 エラー` : ''}
          </p>
          <div className={styles.resultList}>
            {sendResults.map((r, i) => (
              <div key={i} className={`${styles.resultItem} ${r.status === 'success' ? styles.resultOk : styles.resultErr}`}>
                <img src={photos[i].previewUrl} alt="" className={styles.resultThumb} />
                <div className={styles.resultInfo}>
                  <p className={styles.resultFood}>{photos[i].food}</p>
                  {r.status === 'success' && r.result && <p className={styles.resultMeta}>行 {r.result.row}</p>}
                  {r.status === 'error' && <p className={styles.resultError}>{r.error}</p>}
                </div>
                <span className={styles.resultStatus}>{r.status === 'success' ? '✓' : '✗'}</span>
              </div>
            ))}
          </div>
          <button className={styles.primaryBtn} onClick={reset}>続けて記録する</button>
          <button className={styles.secondaryBtn} onClick={() => go({ name: 'home' })}>ホームへ戻る</button>
        </main>
      </div>
    );
  }

  return null;
}
