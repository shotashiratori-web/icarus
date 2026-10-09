import { Fragment, useEffect, useMemo, useState } from 'react';
import { editErrorMessage, fetchEnvironmentSpot, patchEnvironmentSpot, patchSpotObservation, SpotNetworkError } from '../../api/environmentSpotsApi';
import EnvironmentSpotEditForm from './EnvironmentSpotEditForm';
import SpotTerrainSection from './SpotTerrainSection';
import { googleMapsDirectionsUrl } from '../../terrain/externalMaps';
import type { TerrainSnapshot } from '../../terrain/terrainSnapshot';
import { addPhotosToSpot } from '../../environmentSpots/sync';
import {
  LIFE_LABEL, PHOTO_MISSING_LABEL, RESULT_LABEL, STAGE_LABEL,
  type EnvSpeciesItem, type EnvironmentSpot, type FoundStage, type ObsResult, type ObservationInput, type PendingObservation,
} from '../../environmentSpots/types';
import type { SpotMarker } from './useEnvironmentSpots';
import styles from './EnvironmentSpots.module.css';

// 環境スポットの詳細と観察（S3 §3-3・§7-2）。観察は日時単位で保存し、ここで年ごとにまとめる。
// 対象は未選択が初期値（舞茸専用ではない）。結果は あり／なし／見ていない を区別する

type Props = {
  marker: SpotMarker;
  species: EnvSpeciesItem[];
  pendingObs: PendingObservation[];
  idToken: string | null;
  onObserve: (target: { spotId: string | null; pendingSpotId: string | null }, input: ObservationInput) => Promise<void>;
  onClose: () => void;
  isAdmin?: boolean;
  here?: { lat: number; lng: number; accuracy: number } | null;
  onChanged?: () => void; // 訂正・無効化の後に一覧を取り直す
  terrainAt?: (lat: number, lng: number) => Promise<TerrainSnapshot>; // 「地形情報を再取得」（地点を含む山域で計算）
  areaName?: (areaId: string) => string;
  onNavigate?: () => void; // 「ここへ行く」（Field Navigation v1 PR3）
};

interface Row { key: string; observedAt: string; target: string; result: ObsResult; foundStage: FoundStage | null; memo: string; by: string; device: boolean; updatedAt: string | null }

// datetime-local の値（端末のタイムゾーン）
const toLocalInput = (iso: string) => {
  const d = new Date(iso);
  const z = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}T${z(d.getHours())}:${z(d.getMinutes())}`;
};

const MAX_SPOT_PHOTOS = 10;

// 写真の追加は端末に保存しないので、失敗したら電波のある所で選び直してもらう
const photoAddError = (e: unknown) => {
  if (e instanceof SpotNetworkError || (e instanceof Error && e.name === 'PhotoUploadFailedError' && !(e as { code?: string }).code)) {
    return '通信できませんでした。写真の追加は電波のある所でもう一度選んでください（端末には保存しません）';
  }
  return editErrorMessage(e);
};

const fmt = (iso: string) => {
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

export default function EnvironmentSpotDetailSheet({ marker, species, pendingObs, idToken, onObserve, onClose, isAdmin = false, here = null, onChanged, terrainAt, areaName = (id) => id, onNavigate }: Props) {
  const [detail, setDetail] = useState<EnvironmentSpot | null>(marker.remote);
  const [adding, setAdding] = useState(false);
  const [targetId, setTargetId] = useState<string | null>(null);
  const [targetText, setTargetText] = useState('');
  const [result, setResult] = useState<ObsResult | null>(null);
  const [stage, setStage] = useState<FoundStage | null>(null);
  const [memo, setMemo] = useState('');
  // 観察日時: 既定は今。山から戻ってから入れる時は「記録時と同じ（写真の撮影日時）」か日時を選ぶ
  const [obsAt, setObsAt] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [archiveReason, setArchiveReason] = useState('');
  const [obsEdit, setObsEdit] = useState<{ id: string; updatedAt: string; result: ObsResult; stage: FoundStage | null; memo: string; observedAt: string; reason: string } | null>(null);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoMsg, setPhotoMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [editMsg, setEditMsg] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  // 電波があれば詳細（写真の URL・観察）を取り直す
  useEffect(() => {
    if (!marker.spotId || !idToken || !navigator.onLine) return;
    let cancelled = false;
    fetchEnvironmentSpot(marker.spotId, idToken).then((d) => { if (!cancelled) setDetail(d); }, () => undefined);
    return () => { cancelled = true; };
  }, [marker.spotId, idToken, reload]);
  const afterEdit = () => { setReload((n) => n + 1); onChanged?.(); };

  // 登録済みスポットへ写真を追加（訂正と同じく電波のある時だけ・端末に保存しない）
  const addPhotos = async (fileList: FileList | null) => {
    const files = fileList ? Array.from(fileList) : []; // await より前に取り出す（input を空にすると FileList も空になる）
    if (!detail || !idToken || files.length === 0) return;
    if (detail.photos.length + files.length > MAX_SPOT_PHOTOS) { setPhotoMsg({ ok: false, text: `写真は ${MAX_SPOT_PHOTOS} 枚までです（いま ${detail.photos.length} 枚）` }); return; }
    setPhotoBusy(true);
    setPhotoMsg(null);
    try {
      await addPhotosToSpot(detail.id, files, idToken);
      setPhotoMsg({ ok: true, text: `写真を ${files.length} 枚追加しました` });
      afterEdit();
    } catch (e) {
      setPhotoMsg({ ok: false, text: photoAddError(e) });
    } finally {
      setPhotoBusy(false);
    }
  };

  const archiveSpot = async () => {
    if (!detail || !idToken) return;
    setEditMsg(null);
    try {
      await patchEnvironmentSpot(detail.id, { requestId: crypto.randomUUID(), expectedUpdatedAt: detail.updatedAt, changes: { status: 'archived' }, ...(archiveReason.trim() ? { reason: archiveReason.trim() } : {}) }, idToken);
      onChanged?.();
      onClose();
    } catch (e) {
      setEditMsg(editErrorMessage(e));
    }
  };
  const saveObsEdit = async (archive = false) => {
    if (!obsEdit || !idToken) return;
    setEditMsg(null);
    const orig = detail?.observations.find((o) => o.id === obsEdit.id);
    const changes: Record<string, unknown> = {};
    if (archive) changes.status = 'archived';
    else {
      if (orig?.result !== obsEdit.result) changes.result = obsEdit.result;
      const st = obsEdit.result === 'found' ? obsEdit.stage : null;
      if ((orig?.foundStage ?? null) !== st) changes.foundStage = st;
      if ((orig?.memo ?? '') !== obsEdit.memo.trim()) changes.memo = obsEdit.memo.trim();
      if (orig && Date.parse(orig.observedAt) !== Date.parse(obsEdit.observedAt)) changes.observedAt = obsEdit.observedAt;
    }
    if (Object.keys(changes).length === 0) { setEditMsg('変更がありません'); return; }
    try {
      await patchSpotObservation(obsEdit.id, { requestId: crypto.randomUUID(), expectedUpdatedAt: obsEdit.updatedAt, changes, ...(obsEdit.reason.trim() ? { reason: obsEdit.reason.trim() } : {}) }, idToken);
      setObsEdit(null);
      afterEdit();
    } catch (e) {
      setEditMsg(editErrorMessage(e));
    }
  };

  const targets = useMemo(() => species.filter((s) => s.kind === 'target').sort((a, b) => a.sortOrder - b.sortOrder), [species]);
  const nameOf = (id: string | null) => species.find((s) => s.id === id)?.name ?? id ?? '';

  const rows = useMemo<Row[]>(() => {
    const out: Row[] = (detail?.observations ?? []).map((o) => ({ key: o.id, observedAt: o.observedAt, target: o.target, result: o.result, foundStage: o.foundStage, memo: o.memo, by: o.createdByName, device: false, updatedAt: o.updatedAt }));
    const mine = pendingObs.filter((o) => o.stage !== 'registered' && ((marker.spotId && o.spotId === marker.spotId) || (marker.pendingId && o.pendingSpotId === marker.pendingId)));
    for (const o of mine) out.push({ key: o.id, observedAt: o.input.observedAt, target: o.input.targetSpeciesId ? nameOf(o.input.targetSpeciesId) : o.input.targetText ?? '', result: o.input.result, foundStage: o.input.foundStage ?? null, memo: o.input.memo, by: '（この端末・未送信）', device: true, updatedAt: null });
    return out.sort((a, b) => a.observedAt.localeCompare(b.observedAt));
  }, [detail, pendingObs, marker.spotId, marker.pendingId]); // eslint-disable-line react-hooks/exhaustive-deps
  const byYear = useMemo(() => {
    const m = new Map<string, Row[]>();
    for (const r of rows) m.set(r.observedAt.slice(0, 4), [...(m.get(r.observedAt.slice(0, 4)) ?? []), r]);
    return [...m.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  }, [rows]);

  const s = detail;
  const p = marker.pending;
  const canSave = (!!targetId || !!targetText.trim()) && !!result && !saving;
  const save = async () => {
    if (!canSave || !result) return;
    setSaving(true);
    setError(null);
    try {
      await onObserve({ spotId: marker.spotId, pendingSpotId: marker.spotId ? null : marker.pendingId }, {
        observedAt: obsAt ?? new Date().toISOString(), targetSpeciesId: targetId, targetText: targetId ? '' : targetText.trim(),
        result, foundStage: result === 'found' ? stage : null, memo: memo.trim(),
      });
      setAdding(false); setTargetId(null); setTargetText(''); setResult(null); setStage(null); setMemo(''); setObsAt(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存できませんでした');
    } finally {
      setSaving(false);
    }
  };

  const lifeState = s?.lifeState ?? p?.body.lifeState ?? marker.lifeState;
  const spotObservedAt = s?.observedAt ?? p?.body.observedAt ?? null;
  const loc = s ? { src: s.locationSource, acc: s.gpsAccuracyM } : p ? { src: p.body.locationSource, acc: p.body.gpsAccuracyM ?? null } : null;
  const terrain = (s?.terrain ?? p?.body.terrain ?? null) as Record<string, unknown> | null;

  return (
    <section className={styles.sheet} role="dialog" aria-label="環境スポット">
      <div className={styles.head}>
        <h3>{s?.title ?? `${marker.label}${marker.envType === 'tree' ? `（${LIFE_LABEL[lifeState]}）` : ''}`}</h3>
        <button className={styles.btn} onClick={onClose}>閉じる</button>
      </div>
      {onNavigate && (
        <div className={styles.actions}>
          <button className={`${styles.btn} ${styles.primary}`} onClick={onNavigate}>ここへ行く</button>
          {/* 二次操作: 林道まで車で行く時など（座標が Google に渡る） */}
          <a className={styles.chip} href={googleMapsDirectionsUrl(marker.lat, marker.lng)} target="_blank" rel="noreferrer">外部地図で開く</a>
        </div>
      )}
      {marker.origin === 'device' && (
        <p className={marker.status === 'failed' ? styles.warn : styles.sub}>
          {marker.status === 'failed' ? `送信できませんでした: ${marker.error}` : 'この端末に保存済み・未送信（電波のある所で自動的に送信します）'}
        </p>
      )}
      {s && (
        <>
          {s.dbhCm && <p className={styles.sub}>胸高直径 {s.dbhCm}cm</p>}
          {s.decayClass && <p className={styles.sub}>腐朽度 {s.decayClass}</p>}
          <p className={styles.sub}>記録 {s.observedAt ? fmt(s.observedAt) : ''}・{s.createdByName ?? ''}</p>
          {s.memo && <p>{s.memo}</p>}
          {s.photos.length > 0 && (
            <div className={styles.photos}>
              {s.photos.map((ph) => ph.thumbnailUrl
                ? <a key={ph.assetId} href={ph.detailUrl} target="_blank" rel="noreferrer"><img src={ph.thumbnailUrl} alt="写真" /></a>
                : null)}
            </div>
          )}
          {s.photos.length > 0 && !s.photos[0].thumbnailUrl && <p className={styles.sub}>写真 {s.photos.length} 枚（電波のある所で表示）</p>}
          {s.photos.length === 0 && s.photoMissingReason && <p className={styles.sub}>写真なし（{PHOTO_MISSING_LABEL[s.photoMissingReason]}{s.photoMissingMemo ? `: ${s.photoMissingMemo}` : ''}）</p>}
          {s.status === 'active' && s.photos.length < MAX_SPOT_PHOTOS && (
            <div className={styles.actions}>
              <label className={styles.btn} aria-disabled={photoBusy}>{photoBusy ? '写真を送信中…' : '写真を追加'}<input type="file" accept="image/*" multiple hidden disabled={photoBusy} onChange={(e) => { void addPhotos(e.target.files); e.target.value = ''; }} /></label>
            </div>
          )}
          {photoMsg && <p className={photoMsg.ok ? styles.sub : styles.warn}>{photoMsg.text}</p>}
        </>
      )}
      {p && !s && <p className={styles.sub}>写真 {p.photos.length} 枚{p.photos.length === 0 && p.body.photoMissingReason ? `（なし: ${PHOTO_MISSING_LABEL[p.body.photoMissingReason]}）` : ''}</p>}
      {loc && <p className={styles.sub}>位置: {loc.src === 'gps' ? `現在地${loc.acc !== null ? `（精度 約${Math.round(loc.acc)}m）` : ''}` : '地図で指定'}</p>}
      {s && <SpotTerrainSection spot={s} idToken={idToken} terrainAt={terrainAt} areaName={areaName} onDone={afterEdit} />}
      {!s && terrain && <p className={styles.sub}>記録時の地形: {[terrain.aspect && `方位 ${terrain.aspect}`, terrain.landform, terrain.slopeDeg !== undefined && `傾斜 ${terrain.slopeDeg}°`, terrain.stream].filter(Boolean).join('・')}</p>}

      {s && !editing && (
        <div className={styles.actions}>
          <button className={styles.btn} onClick={() => { setEditing(true); setEditMsg(null); }}>訂正</button>
          {isAdmin && <button className={styles.btn} onClick={() => setArchiving((v) => !v)}>無効化（管理者）</button>}
        </div>
      )}
      {s && editing && (
        <EnvironmentSpotEditForm spot={s} species={species} idToken={idToken} here={here} onCancel={() => setEditing(false)} onDone={() => { setEditing(false); afterEdit(); }} />
      )}
      {s && archiving && isAdmin && (
        <>
          <p className={styles.sub}>無効化すると地図と一覧に出なくなります（記録と履歴は消えません）</p>
          <input className={styles.input} value={archiveReason} onChange={(e) => setArchiveReason(e.target.value)} placeholder="理由（任意・履歴に残ります）" maxLength={500} />
          <div className={styles.actions}>
            <button className={styles.btn} onClick={() => setArchiving(false)}>やめる</button>
            <button className={`${styles.btn} ${styles.primary}`} onClick={() => void archiveSpot()}>無効化する</button>
          </div>
        </>
      )}
      {editMsg && <p className={styles.warn}>{editMsg}</p>}

      <p className={styles.label}>観察</p>
      {byYear.length === 0 && <p className={styles.sub}>まだ観察はありません</p>}
      {byYear.map(([year, list]) => (
        <div key={year}>
          <p className={styles.year}>{year}年</p>
          {list.map((r) => (
            <Fragment key={r.key}>
            <div className={styles.obs}>
              <span>{fmt(r.observedAt)}</span>
              <span>
                {r.target}：<b>{RESULT_LABEL[r.result]}</b>{r.foundStage ? `（${STAGE_LABEL[r.foundStage]}）` : ''}{r.memo ? `・${r.memo}` : ''}<br /><small>{r.by}</small>
                {!r.device && r.updatedAt && obsEdit?.id !== r.key && (
                  <> <button className={styles.chip} onClick={() => setObsEdit({ id: r.key, updatedAt: r.updatedAt!, result: r.result, stage: r.foundStage, memo: r.memo, observedAt: r.observedAt, reason: '' })}>訂正</button></>
                )}
              </span>
            </div>
            {obsEdit?.id === r.key && (
              <div>
                <div className={styles.chips}>
                  {(['found', 'not_found', 'not_checked'] as ObsResult[]).map((x) => (
                    <button key={x} className={`${styles.chip} ${obsEdit.result === x ? styles.on : ''}`} onClick={() => setObsEdit({ ...obsEdit, result: x })}>{RESULT_LABEL[x]}</button>
                  ))}
                </div>
                {obsEdit.result === 'found' && (
                  <div className={styles.chips}>
                    {(Object.keys(STAGE_LABEL) as FoundStage[]).map((st) => (
                      <button key={st} className={`${styles.chip} ${obsEdit.stage === st ? styles.on : ''}`} onClick={() => setObsEdit({ ...obsEdit, stage: obsEdit.stage === st ? null : st })}>{STAGE_LABEL[st]}</button>
                    ))}
                  </div>
                )}
                <input
                  className={styles.input}
                  type="datetime-local"
                  aria-label="観察日時の訂正"
                  value={toLocalInput(obsEdit.observedAt)}
                  onChange={(e) => { const d = new Date(e.target.value); if (!Number.isNaN(d.getTime())) setObsEdit({ ...obsEdit, observedAt: d.toISOString() }); }}
                />
                {spotObservedAt && (
                  <div className={styles.chips}>
                    <button className={styles.chip} onClick={() => setObsEdit({ ...obsEdit, observedAt: spotObservedAt })}>記録時と同じ（{fmt(spotObservedAt)}）</button>
                  </div>
                )}
                <input className={styles.input} value={obsEdit.memo} onChange={(e) => setObsEdit({ ...obsEdit, memo: e.target.value })} placeholder="メモ" maxLength={1000} />
                <input className={styles.input} value={obsEdit.reason} onChange={(e) => setObsEdit({ ...obsEdit, reason: e.target.value })} placeholder="訂正の理由（任意）" maxLength={500} />
                <div className={styles.actions}>
                  <button className={styles.btn} onClick={() => setObsEdit(null)}>やめる</button>
                  {isAdmin && <button className={styles.btn} onClick={() => void saveObsEdit(true)}>無効化</button>}
                  <button className={`${styles.btn} ${styles.primary}`} onClick={() => void saveObsEdit()}>訂正を送信</button>
                </div>
              </div>
            )}
            </Fragment>
          ))}
        </div>
      ))}

      {!adding && <div className={styles.actions}><button className={`${styles.btn} ${styles.primary}`} onClick={() => setAdding(true)}>観察を追加</button></div>}
      {adding && (
        <>
          <p className={styles.label}>何を見ましたか（対象）</p>
          <div className={styles.chips}>
            {targets.map((t) => (
              <button key={t.id} className={`${styles.chip} ${targetId === t.id ? styles.on : ''}`} onClick={() => { setTargetId(targetId === t.id ? null : t.id); setTargetText(''); }}>{t.name}</button>
            ))}
          </div>
          <input className={styles.input} value={targetText} onChange={(e) => { setTargetText(e.target.value); if (e.target.value) setTargetId(null); }} placeholder="ほかの対象（自由入力）" maxLength={60} />
          <p className={styles.label}>結果</p>
          <div className={styles.bigButtons}>
            {(['found', 'not_found', 'not_checked'] as ObsResult[]).map((r) => (
              <button key={r} className={`${styles.big} ${result === r ? styles.on : ''}`} onClick={() => setResult(r)} aria-pressed={result === r}>{RESULT_LABEL[r]}</button>
            ))}
          </div>
          <p className={styles.sub}>「見ていない」= その木へ行ったが対象を確認していない（「探したが無かった」は「なし」）</p>
          {result === 'found' && (
            <>
              <p className={styles.label}>状態（任意）</p>
              <div className={styles.chips}>
                {(Object.keys(STAGE_LABEL) as FoundStage[]).map((st) => (
                  <button key={st} className={`${styles.chip} ${stage === st ? styles.on : ''}`} onClick={() => setStage(stage === st ? null : st)}>{STAGE_LABEL[st]}</button>
                ))}
              </div>
            </>
          )}
          <p className={styles.label}>いつ見ましたか</p>
          <div className={styles.chips}>
            <button className={`${styles.chip} ${obsAt === null ? styles.on : ''}`} onClick={() => setObsAt(null)}>今</button>
            {spotObservedAt && (
              <button className={`${styles.chip} ${obsAt === spotObservedAt ? styles.on : ''}`} onClick={() => setObsAt(spotObservedAt)}>記録時と同じ（{fmt(spotObservedAt)}）</button>
            )}
          </div>
          <input
            className={styles.input}
            type="datetime-local"
            aria-label="観察日時"
            value={toLocalInput(obsAt ?? new Date().toISOString())}
            onChange={(e) => { const d = new Date(e.target.value); if (!Number.isNaN(d.getTime())) setObsAt(d.toISOString()); }}
          />
          <p className={styles.label}>メモ（任意）</p>
          <input className={styles.input} value={memo} onChange={(e) => setMemo(e.target.value)} maxLength={1000} />
          {error && <p className={styles.warn}>{error}</p>}
          <div className={styles.actions}>
            <button className={styles.btn} onClick={() => setAdding(false)}>やめる</button>
            <button className={`${styles.btn} ${styles.primary}`} disabled={!canSave} onClick={() => void save()}>{saving ? '保存中…' : '端末に保存して送信'}</button>
          </div>
        </>
      )}
    </section>
  );
}
