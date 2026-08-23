import { useCallback, useEffect, useRef, useState } from 'react';
import {
  resizeToJpeg, fetchGps, fetchFoodCandidates,
  extractExifDate, extractExifGps,
  sha256Hex, readFileAsBase64, getImageDimensions, isHeicFile,
} from '../api/icarusApi';
import {
  emptyCommonFields,
  emptyPhotoEntry,
  todayString,
  LARGE_CATEGORY_OPTIONS,
  getPhaseOptions,
  HARVESTED_OPTIONS,
  MAX_PHOTOS,
  type PhotoEntry,
  type CommonFields,
  type FoodCandidate,
  type PhotoSendResult,
  type SubmitMode,
} from '../types/foodLog';
import { saveFoodLogDraft, loadFoodLogDraft, clearFoodLogDraft } from '../db/localDB';
import { useAuth } from '../context/AuthContext';
import { submitWithFallback } from '../submission/orchestrator';
import { UNSUPPORTED_MEDIA_TYPE_DESCRIPTION } from '../submission/errorMapping';
import * as queueDB from '../submission/queueDB';
import type { FoodLogSubmissionPayload } from '../submission/adapters/foodLogAdapter';
import type { FieldLogD1SubmissionPayload } from '../submission/adapters/fieldLogD1Adapter';
import { FIELD_LOG_D1_ENABLED_STAFF, PHOTO_ASSET_R2_ENABLED } from '../config';
import { useZukanFieldStore } from '../store/zukanFieldStore';
import { buildFieldLogId } from '../types/zukan';
import type { Screen } from '../App';
import HomeButton from '../components/HomeButton';
import styles from './FoodLogScreen.module.css';

// Unit D: Worker+D1新経路の許可対象アカウントかどうか。ここをtrueにする条件を無くせば全員が既存GAS経路へ戻る
function isFieldLogD1Enabled(userEmail: string): boolean {
  const normalized = userEmail.trim().toLowerCase();
  return FIELD_LOG_D1_ENABLED_STAFF.some((e) => e.toLowerCase() === normalized);
}

// Photo Asset Architecture v1（Stage 1）。R2 Assetのmime_typeとして保存する値を決める。
// file.typeはブラウザ/OSによって空文字やHEIC判定が不安定なことがあるため、既存のisHeicFile()
// （拡張子+MIME両方を見る、HEIC変換要否判定で既に使われている判定）を流用して補う
function resolveAssetMimeType(file: File): string {
  if (isHeicFile(file)) return 'image/heic';
  if (file.type === 'image/jpeg' || file.type === 'image/png' || file.type === 'image/heif') return file.type;
  return file.name.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg';
}

type Phase = 'photoSelect' | 'photoEdit' | 'confirm' | 'sending' | 'complete';

type Props = { go: (s: Screen) => void; editItemId?: string };

export default function FoodLogScreen({ go, editItemId }: Props) {
  const { idToken, userEmail, authState, signInContainerRef, handleTokenExpired, signOut: authSignOut } = useAuth();
  const [phase, setPhase] = useState<Phase>('photoSelect');
  const initializedRef = useRef(false);

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
  const [draftRestored, setDraftRestored] = useState(false);

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
    // 保留一覧からの編集中は、通常の下書き（単一スロット）を上書きしない
    if (editItemId) return;
    if (phase !== 'sending' && phase !== 'complete') {
      void saveDraft(photos, common, submitMode, currentIdx);
    }
  }, [photos, common, submitMode, currentIdx, phase, saveDraft, editItemId]);

  // ── 初回サインイン時に一度だけ：食材候補の取得 + 下書き復元 ──────
  // 保留一覧からの編集(editItemId)のときは、下書きではなくqueueの内容を復元するので対象外
  useEffect(() => {
    if (authState !== 'ready' || initializedRef.current || editItemId) return;
    initializedRef.current = true;
    fetchFoodCandidates().then(setFoodCandidates);
    loadFoodLogDraft().then((draft) => {
      if (draft && draft.photos.length > 0) {
        setPhotos(draft.photos.map(p => ({
          ...p,
          // このデプロイ以前に保存された下書きにはeventIdが無い場合があるため、無ければここで補う
          eventId: p.eventId || crypto.randomUUID(),
          previewUrl: p.base64 ? `data:image/jpeg;base64,${p.base64}` : '',
        })));
        setCommon(draft.commonFields);
        setSubmitMode(draft.submitMode ?? 'batch');
        setCurrentIdx(draft.currentPhotoIndex);
        setDraftRestored(true);
      }
    });
  }, [authState, editItemId]);

  // ── 保留一覧からの編集：queueの1件を復元してphotoEditへ ─────────
  useEffect(() => {
    if (!editItemId || authState !== 'ready' || initializedRef.current) return;
    initializedRef.current = true;
    fetchFoodCandidates().then(setFoodCandidates);
    queueDB.get(editItemId).then((item) => {
      if (!item) { setPhase('photoSelect'); return; } // 既に再送/削除済み
      const payload = item.payload as FoodLogSubmissionPayload;
      const restoredPhoto: PhotoEntry = {
        ...payload.photo,
        previewUrl: payload.photo.base64 ? `data:image/jpeg;base64,${payload.photo.base64}` : '',
        largeCategory: payload.common.largeCategory,
        place: payload.common.place,
        harvested: payload.common.harvested,
      };
      setPhotos([restoredPhoto]);
      setSubmitMode('individual');
      setCurrentIdx(0);
      setPhase('photoEdit');
    });
  }, [editItemId, authState]);

  // ── 写真追加（EXIF 日付自動抽出） ─────────────────────────
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;
    const remaining = MAX_PHOTOS - photos.length;
    const toProcess = files.slice(0, remaining);
    setPhotoProcessing(true);
    // Photo Asset Architecture v1（Stage 1: Admin Field Log R2 MVP）対象かどうか。
    // 一般スタッフ・Work Log・Wine・Spotは対象外（isFieldLogD1Enabledと同じAdmin限定判定を流用）
    const useR2Asset = PHOTO_ASSET_R2_ENABLED && isFieldLogD1Enabled(userEmail);
    // Stage 1A: Photo Asset APIはimage/jpegのみ受け付ける（400 ASSET_UNSUPPORTED_MIME_TYPE）。
    // 正本の判定はAPI側のまま変えないが、選択直後にわかっていれば保留キューへ積む前に案内できる
    // （UX改善。isHeicFile()の誤判定でAPIまで到達しても、そちらは引き続き明確な4xxで拒否される）
    const rejectedForMimeType = useR2Asset ? toProcess.filter((f) => isHeicFile(f)) : [];
    const acceptable = useR2Asset ? toProcess.filter((f) => !isHeicFile(f)) : toProcess;
    try {
      // 写真自体のEXIF GPSを最優先で使う（撮影場所と登録場所がずれるケースに対応）。
      // EXIFにGPSが無い写真（スクショ・位置情報オフの端末など）だけ、同じ場所で撮ったものとみなし
      // ライブ位置情報を1回だけ取得して共有で補う
      const newEntries = await Promise.all(
        acceptable.map(async (file) => {
          // resize後JPEG（プレビュー・既存Cloudinary経路用）と、Asset original用の元Fileメタデータを並列取得。
          // resize済みJPEGはR2 originalとして使わない（元FileそのものをassetOriginalBase64として別途保持する）
          const [base64, exif, exifGps, assetOriginalBase64, fileHash, dimensions] = await Promise.all([
            resizeToJpeg(file),
            extractExifDate(file),
            extractExifGps(file),
            useR2Asset ? readFileAsBase64(file) : Promise.resolve(undefined),
            useR2Asset ? sha256Hex(file) : Promise.resolve(undefined),
            useR2Asset ? getImageDimensions(file) : Promise.resolve(null),
          ]);
          const entry = emptyPhotoEntry();
          return {
            ...entry,
            base64,
            previewUrl: `data:image/jpeg;base64,${base64}`,
            date: exif?.date ?? '',
            takenAt: exif?.takenAt,
            gps: exifGps ? { ...exifGps, accuracy: 0 } : undefined,
            fileName: file.name,
            ...(useR2Asset ? {
              assetOriginalBase64,
              fileHash,
              assetMimeType: resolveAssetMimeType(file),
              assetSizeBytes: file.size,
              assetWidth: dimensions?.width,
              assetHeight: dimensions?.height,
            } : {}),
          };
        }),
      );

      if (newEntries.some((entry) => !entry.gps)) {
        const liveGps = await fetchGps();
        if (liveGps) {
          for (const entry of newEntries) {
            if (!entry.gps) entry.gps = liveGps;
          }
        }
      }

      setPhotos(prev => [...prev, ...newEntries]);
      if (rejectedForMimeType.length > 0) {
        alert(UNSUPPORTED_MEDIA_TYPE_DESCRIPTION);
      }
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
  // 送信できなかった写真は「エラー」ではなく「保留」としてSubmission Frameworkのqueueへ格納する。
  // 失敗してもここで例外は投げない（submitWithFallbackは常に成功/保留のいずれかで解決する）。
  const startSend = async () => {
    const useD1 = isFieldLogD1Enabled(userEmail);

    // D1経路はdate必須（Worker側のバリデーションと一致させる）。GAS経路は既存どおり日付未入力でも送信できる。
    // 今日の日付を自動で補うことはしない（ユーザーが気づかないまま誤った日付が保存されるのを防ぐ）
    if (useD1 && photos.some((p) => !p.date.trim())) {
      alert('日付を入力してください');
      return;
    }

    setPhase('sending');
    const results: PhotoSendResult[] = photos.map((_, i) => ({ photoIndex: i, status: 'idle' }));
    setSendResults([...results]);

    for (let i = 0; i < photos.length; i++) {
      results[i] = { ...results[i], status: 'sending' };
      setSendResults([...results]);

      const cf = commonFieldsFor(photos[i]);
      let outcome: Awaited<ReturnType<typeof submitWithFallback>>;

      if (useD1) {
        // Unit D（Worker+D1新経路）。requestId/eventIdは送信開始時に生成済みのものをそのまま使い、
        // 再試行でも作り直さない（D1冪等性の根拠のため）
        const useR2Asset = PHOTO_ASSET_R2_ENABLED && !!photos[i].assetOriginalBase64;
        const d1Payload: FieldLogD1SubmissionPayload = {
          eventId: photos[i].eventId,
          requestId: photos[i].requestId,
          date: photos[i].date,
          food: photos[i].food,
          place: cf.place,
          memo: photos[i].memo,
          largeCategory: cf.largeCategory,
          latitude: photos[i].gps?.lat,
          longitude: photos[i].gps?.lng,
          takenAt: photos[i].takenAt,
          hasPhoto: !!photos[i].base64,
          photoFileName: photos[i].fileName,
          // useR2AssetならCloudinary経路(photoBase64)は使わない。既存Cloudinary分岐は無変更のまま残す
          photoBase64: useR2Asset ? undefined : (photos[i].base64 || undefined),
          useR2Asset,
          assetOriginalBase64: useR2Asset ? photos[i].assetOriginalBase64 : undefined,
          assetFileHash: useR2Asset ? photos[i].fileHash : undefined,
          assetMimeType: useR2Asset ? photos[i].assetMimeType : undefined,
          assetSizeBytes: useR2Asset ? photos[i].assetSizeBytes : undefined,
          assetWidth: useR2Asset ? photos[i].assetWidth : undefined,
          assetHeight: useR2Asset ? photos[i].assetHeight : undefined,
        };
        outcome = await submitWithFallback({
          entity: 'fieldLogD1',
          itemId: photos[i].requestId,
          payload: d1Payload,
          title: photos[i].food || '(食材名未入力)',
          photoThumbnail: photos[i].previewUrl,
          displayDate: photos[i].date,
          idToken,
        });

        // D1保存成功時、GPSがあれば図鑑ストアへ即時反映する（画面遷移直後から一覧・地図に見える状態にする）。
        // GPSが無い場合はFieldLogEntryのlat/lngを構成できないため、この即時反映はスキップする
        // （D1への保存自体は成功しており、Sheets同期後の再読み込みで通常どおり見えるようになる）
        if (outcome.ok && photos[i].gps) {
          const gps = photos[i].gps!;
          const recordedAt = new Date().toISOString();
          useZukanFieldStore.getState().addEntry({
            id: buildFieldLogId(d1Payload.date, gps.lat, gps.lng, recordedAt),
            foodName: d1Payload.food,
            place: d1Payload.place,
            date: d1Payload.date,
            memo: d1Payload.memo,
            photoUrl: d1Payload.photoUrl ?? '',
            notionUrl: '',
            elevation: null,
            kigo: '',
            lat: gps.lat,
            lng: gps.lng,
            recordedAt,
            eventId: d1Payload.eventId,
            takenAt: d1Payload.takenAt ?? '',
          });
        }
      } else {
        const { previewUrl: _pv, ...photoForPayload } = photos[i];
        const payload: FoodLogSubmissionPayload = { photo: photoForPayload, common: cf };
        outcome = await submitWithFallback({
          entity: 'foodLog',
          itemId: photos[i].requestId,
          payload,
          title: photos[i].food || '(食材名未入力)',
          photoThumbnail: photos[i].previewUrl,
          displayDate: photos[i].date,
          idToken,
        });
      }

      if (outcome.ok) {
        results[i] = { ...results[i], status: 'success' };
      } else {
        results[i] = { ...results[i], status: 'queued' };
        if (outcome.item.lastError?.code === 'AUTH_EXPIRED') handleTokenExpired();
      }
      setSendResults([...results]);
    }

    // 保留一覧からの編集中はそもそも下書きスロットに書き込んでいないので、無関係な下書きを消さないよう対象外にする
    // (IndexedDBが一時的に開けない場合でも、送信結果の画面遷移は必ず行う)
    if (!editItemId) await clearFoodLogDraft().catch(() => {});
    // 保留一覧からの編集→再送のときは、完了画面を出さずそのまま一覧へ戻る。
    // 成功していればqueueから消えており、まだ保留ならlastErrorが更新された状態で残っている。
    if (editItemId) {
      go({ name: 'pendingList' });
      return;
    }
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
    setPhotos([]); setCommon(emptyCommonFields());
    setSubmitMode('batch');
    setCurrentIdx(0); setDraftRestored(false);
    void clearFoodLogDraft();
    initializedRef.current = false;
    authSignOut();
  };

  // ── 食材候補フィルター ─────────────────────────────────────
  const filteredCandidates = candidateQuery.length > 0
    ? foodCandidates.filter(c => c.name.toLowerCase().includes(candidateQuery.toLowerCase())).slice(0, 8)
    : [];

  // ════════════════════════════════════════════════════════
  // RENDER
  // ════════════════════════════════════════════════════════

  // ── 認証 ─────────────────────────────────────────────────
  if (authState === 'checking') {
    return (
      <div className={styles.root}>
        <header className={styles.header}>
          <button className={styles.backBtn} onClick={() => go({ name: 'home' })}>← 戻る</button>
          <span className={styles.headerTitle}>食材ログ</span>
        </header>
        <main className={styles.authMain}>
          <div className={styles.spinner} />
        </main>
      </div>
    );
  }

  if (authState === 'signedOut') {
    return (
      <div className={styles.root}>
        <header className={styles.header}>
          <button className={styles.backBtn} onClick={() => go({ name: 'home' })}>← 戻る</button>
          <span className={styles.headerTitle}>食材ログ</span>
        </header>
        <main className={styles.authMain}>
          <div className={styles.authCard}>
            <p className={styles.authLead}>ログインが切れています。再度ログインしてください。</p>
            <div ref={signInContainerRef} className={styles.googleBtnWrap} />
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
    // 一件ずつ送信ではこの写真自身の大分類、まとめて送信では共通の大分類でフェーズ選択肢を切り替える
    const categoryForPhase = submitMode === 'individual' ? (photo.largeCategory ?? '') : common.largeCategory;
    const phaseOptions = getPhaseOptions(categoryForPhase);

    return (
      <div className={styles.root}>
        <header className={styles.header}>
          <button className={styles.backBtn} onClick={() => setPhase('photoSelect')}>← 共通</button>
          <span className={styles.headerTitle}>写真ごとの入力</span>
          <button className={styles.signOutBtn} onClick={signOut} title={userEmail}>
            {userEmail.split('@')[0]}
          </button>
          <HomeButton go={go} />
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
              {phaseOptions.map(o => <option key={o} value={o}>{o}</option>)}
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
          <HomeButton go={go} />
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
                r.status === 'queued'  ? styles.sendDotErr :
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
    const queuedCount  = sendResults.filter(r => r.status === 'queued').length;
    return (
      <div className={styles.root}>
        <header className={styles.header}>
          <button className={styles.backBtn} onClick={() => go({ name: 'home' })}>← ホーム</button>
          <span className={styles.headerTitle}>送信完了</span>
        </header>
        <main className={styles.completeMain}>
          <div className={queuedCount === 0 ? styles.successIcon : styles.warnIcon}>
            {queuedCount === 0 ? '✓' : '🟡'}
          </div>
          {queuedCount === 0 ? (
            <p className={styles.successFood}>{successCount} 件 記録しました</p>
          ) : (
            <p className={styles.successFood}>
              🟡 {queuedCount}件を保留しました。<br />
              通信またはサーバーの都合で送信できませんでした。<br />
              データは保存されています。あとから再送できます。
            </p>
          )}
          <div className={styles.resultList}>
            {sendResults.map((r, i) => (
              <div key={i} className={`${styles.resultItem} ${r.status === 'success' ? styles.resultOk : styles.resultErr}`}>
                <img src={photos[i].previewUrl} alt="" className={styles.resultThumb} />
                <div className={styles.resultInfo}>
                  <p className={styles.resultFood}>{photos[i].food}</p>
                  {r.status === 'success' && r.result && <p className={styles.resultMeta}>行 {r.result.row}</p>}
                  {r.status === 'queued' && <p className={styles.resultError}>保留中（あとで再送できます）</p>}
                </div>
                <span className={styles.resultStatus}>{r.status === 'success' ? '✓' : '🟡'}</span>
              </div>
            ))}
          </div>
          {queuedCount > 0 && (
            <button className={styles.primaryBtn} onClick={() => go({ name: 'pendingList' })}>保留一覧を見る</button>
          )}
          <button className={styles.primaryBtn} onClick={reset}>続けて記録する</button>
          <button className={styles.secondaryBtn} onClick={() => go({ name: 'home' })}>ホームへ戻る</button>
        </main>
      </div>
    );
  }

  return null;
}
