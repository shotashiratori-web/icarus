import { TokenExpiredError } from '../api/icarusApi';
import { addSpotObservation, createEnvironmentSpot, SpotApiError, SpotNetworkError } from '../api/environmentSpotsApi';
import { createOrReuseAsset, finalizeAsset } from '../api/photoAssetApi';
import {
  getPendingObservation, getPendingSpot, putPendingObservation, putPendingSpot, updatePendingObservation, updatePendingSpot,
} from './store';
import type { ObservationInput, PendingError, PendingObservation, PendingPhoto, PendingSpot, SpotCreateBody } from './types';

// Environment Spots の送信（S3 §3-2）。登録の経路はこれ 1 つ:
//   記録 → まず端末（IndexedDB）に入力と写真の原本を保存（通信しない）→ 送信（できれば即時、できなければあとで自動）
//   saved →（写真ごとに POST /assets（requestId = 写真の id で冪等）→ R2 へ PUT → finalize）→ photos_uploaded
//   photos_uploaded →（POST /environment-spots、requestId = 端末の id で冪等）→ registered
// 登録が済んでから写真の原本を端末から外す（原本は R2）。観察はスポットの登録が済んでから送る

export const ALLOWED_PHOTO_TYPES = ['image/jpeg', 'image/heic', 'image/heif'];

export class SpotRejectedError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'SpotRejectedError';
    this.code = code;
  }
}

async function sha256Hex(buf: ArrayBuffer): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(d)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function photoFromFile(file: File): Promise<PendingPhoto> {
  const data = await file.arrayBuffer();
  const type = file.type || 'image/jpeg';
  if (!ALLOWED_PHOTO_TYPES.includes(type)) throw new SpotRejectedError('PHOTO_TYPE', `この形式の写真は送れません（${type}）。カメラで撮った写真（JPEG・HEIC）を選んでください`);
  return { id: crypto.randomUUID(), name: file.name || 'photo.jpg', type, data, bytes: data.byteLength, sha256: await sha256Hex(data), assetId: null };
}

// 端末に保存する（通信しない）
export async function saveNewSpot(body: PendingSpot['body'], photos: PendingPhoto[]): Promise<PendingSpot> {
  if (photos.length === 0 && !body.photoMissingReason) throw new SpotRejectedError('SPOT_PHOTO_REQUIRED', '写真を撮るか、写真が無い理由を選んでください');
  const now = new Date().toISOString();
  const p: PendingSpot = { id: crypto.randomUUID(), body, photos, stage: 'saved', spotId: null, lastError: null, attempts: 0, createdAt: now, updatedAt: now, registeredAt: null };
  await putPendingSpot(p);
  return p;
}

export async function saveNewObservation(target: { spotId: string | null; pendingSpotId: string | null }, input: ObservationInput): Promise<PendingObservation> {
  if (!input.targetSpeciesId && !input.targetText?.trim()) throw new SpotRejectedError('OBSERVATION_TARGET', '観察の対象を選ぶか入力してください');
  const now = new Date().toISOString();
  const p: PendingObservation = { id: crypto.randomUUID(), ...target, input, stage: 'saved', observationId: null, lastError: null, attempts: 0, createdAt: now, updatedAt: now };
  await putPendingObservation(p);
  return p;
}

function errorOf(e: unknown): PendingError {
  const at = new Date().toISOString();
  if (e instanceof TokenExpiredError) return { code: 'AUTH_EXPIRED', message: 'ログインが必要です。ログインすると自動で送信します', retryable: true, at };
  if (e instanceof SpotNetworkError) return { code: 'NETWORK_ERROR', message: e.message, retryable: true, at };
  if (e instanceof SpotRejectedError) return { code: e.code, message: e.message, retryable: false, at };
  if (e instanceof SpotApiError) {
    return e.retryable
      ? { code: e.code, message: `サーバーの都合で送信できませんでした（${e.status}）。あとで自動的に送信します`, retryable: true, at }
      : { code: e.code, message: e.message, retryable: false, at };
  }
  // 写真のアップロード（既存の photoAssetApi）の通信失敗は再送できる
  if (e instanceof Error && e.name === 'PhotoUploadFailedError') {
    const code = (e as { code?: string }).code;
    return code === 'ASSET_UNSUPPORTED_MIME_TYPE'
      ? { code, message: 'この形式の写真は送れません', retryable: false, at }
      : { code: 'PHOTO_UPLOAD', message: `写真を送れませんでした（${e.message}）。あとで自動的に送信します`, retryable: true, at };
  }
  return { code: 'UNKNOWN', message: e instanceof Error ? e.message : '送信できませんでした', retryable: true, at };
}

async function putToR2(url: string, data: ArrayBuffer, type: string): Promise<void> {
  let res: Response;
  try {
    res = await fetch(url, { method: 'PUT', headers: { 'Content-Type': type }, body: data });
  } catch {
    throw new SpotNetworkError();
  }
  if (!res.ok) throw new SpotApiError(res.status >= 500 ? res.status : 502, 'R2_PUT_FAILED', `写真のアップロードに失敗しました（HTTP ${res.status}）`);
}

const inFlight = new Map<string, Promise<unknown>>();
function once<T>(key: string, run: () => Promise<T>): Promise<T> {
  const r = inFlight.get(key) as Promise<T> | undefined;
  if (r) return r;
  const p = run().finally(() => inFlight.delete(key));
  inFlight.set(key, p);
  return p;
}

export function syncSpot(id: string, idToken: string): Promise<PendingSpot> {
  return once(`spot:${id}`, () => runSpot(id, idToken));
}

async function runSpot(id: string, idToken: string): Promise<PendingSpot> {
  let p = await getPendingSpot(id);
  if (!p) throw new SpotRejectedError('PENDING_NOT_FOUND', '端末に記録がありません');
  if (p.stage === 'registered') return p;
  p = (await updatePendingSpot(id, { attempts: p.attempts + 1 }))!;
  try {
    if (p.stage === 'saved') {
      for (const ph of p.photos) {
        if (ph.assetId) continue;
        if (!ph.data) throw new SpotRejectedError('LOCAL_PHOTO_MISSING', '端末の写真が見つかりません');
        if ((await sha256Hex(ph.data)) !== ph.sha256) throw new SpotRejectedError('LOCAL_PHOTO_CORRUPTED', '端末の写真が保存時と一致しません');
        const created = await createOrReuseAsset({
          requestId: ph.id, fileHash: ph.sha256, originalFilename: ph.name, mimeType: ph.type, sizeBytes: ph.bytes,
          width: null, height: null, takenAt: null, exifGpsLat: null, exifGpsLng: null,
        }, idToken);
        if (created.uploadRequired) {
          if (!created.presignedUploadUrl) throw new SpotApiError(502, 'NO_PRESIGNED_URL', '写真の送り先が発行されませんでした');
          await putToR2(created.presignedUploadUrl, ph.data, ph.type);
          await finalizeAsset(created.assetId, idToken);
        }
        p = (await updatePendingSpot(id, (cur) => ({ photos: cur.photos.map((x) => (x.id === ph.id ? { ...x, assetId: created.assetId } : x)) })))!;
      }
      p = (await updatePendingSpot(id, { stage: 'photos_uploaded', lastError: null }))!;
    }
    if (p.stage === 'photos_uploaded') {
      const body: SpotCreateBody = { ...p.body, requestId: p.id, photoAssetIds: p.photos.map((x) => x.assetId!).filter(Boolean) };
      let res;
      try {
        res = await createEnvironmentSpot(body, idToken);
      } catch (e) {
        if (e instanceof SpotApiError && !e.retryable) throw new SpotRejectedError(e.code, e.message);
        throw e;
      }
      // 登録が済んだら写真の原本を外す（R2 にある）
      p = (await updatePendingSpot(id, (cur) => ({
        stage: 'registered', spotId: res.item.id, registeredAt: new Date().toISOString(), lastError: null,
        photos: cur.photos.map((x) => ({ ...x, data: null })),
      })))!;
    }
    return p;
  } catch (e) {
    await updatePendingSpot(id, { lastError: errorOf(e) });
    throw e;
  }
}

export function syncObservation(id: string, idToken: string): Promise<PendingObservation> {
  return once(`obs:${id}`, () => runObservation(id, idToken));
}

async function runObservation(id: string, idToken: string): Promise<PendingObservation> {
  let o = await getPendingObservation(id);
  if (!o) throw new SpotRejectedError('PENDING_NOT_FOUND', '端末に記録がありません');
  if (o.stage === 'registered') return o;
  o = (await updatePendingObservation(id, { attempts: o.attempts + 1 }))!;
  try {
    let spotId = o.spotId;
    if (!spotId && o.pendingSpotId) {
      const s = await syncSpot(o.pendingSpotId, idToken); // 先にスポットを送る
      spotId = s.spotId;
      if (spotId) o = (await updatePendingObservation(id, { spotId }))!;
    }
    if (!spotId) throw new SpotRejectedError('SPOT_NOT_REGISTERED', 'スポットの登録が済んでいません');
    let res;
    try {
      res = await addSpotObservation(spotId, { ...o.input, requestId: o.id }, idToken);
    } catch (e) {
      if (e instanceof SpotApiError && !e.retryable) throw new SpotRejectedError(e.code, e.message);
      throw e;
    }
    o = (await updatePendingObservation(id, { stage: 'registered', observationId: res.item.id, lastError: null }))!;
    return o;
  } catch (e) {
    await updatePendingObservation(id, { lastError: errorOf(e) });
    throw e;
  }
}

// 利用者が「もう一度送る」を押した時（再送できない失敗の印を外す）
export async function clearSpotFailure(id: string): Promise<void> {
  await updatePendingSpot(id, { lastError: null });
}
