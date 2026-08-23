// Photo Asset Architecture v1（Stage 1: Admin Field Log R2 MVP）。
// POST /assets → presigned PUT → POST /assets/:id/finalize、の3ステップをまとめる。
// fieldLogD1Api.tsのCloudinary版（fetchCloudinarySignature/uploadJpegBase64ToCloudinary）と
// 同じ役割分担・同じエラー方針（アップロード段階の失敗はPhotoUploadFailedErrorで区別する）。

import { ASSETS_CREATE_URL, assetFinalizeUrl } from '../config';
import { TokenExpiredError } from './icarusApi';
import { PhotoUploadFailedError } from './fieldLogD1Api';

export interface CreateAssetInput {
  requestId: string;
  fileHash: string;
  originalFilename: string;
  mimeType: string;
  sizeBytes: number | null;
  width: number | null;
  height: number | null;
  takenAt: string | null;
  exifGpsLat: number | null;
  exifGpsLng: number | null;
}

interface CreateAssetResponse {
  status?: 'error';
  message?: string;
  assetId?: string;
  assetStatus?: string;
  uploadRequired?: boolean;
  presignedUploadUrl?: string;
  requiredHeaders?: Record<string, string>;
}

export interface CreateAssetResult {
  assetId: string;
  assetStatus: string;
  uploadRequired: boolean;
  presignedUploadUrl?: string;
  requiredHeaders?: Record<string, string>;
}

async function postJson<T>(url: string, idToken: string, body: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
      body: JSON.stringify(body),
    });
  } catch {
    throw new PhotoUploadFailedError('通信に失敗しました');
  }
  if (res.status === 401) {
    throw new TokenExpiredError('ログインセッションが切れました。再度ログインしてください。');
  }
  let json: T & { status?: string; message?: string; code?: string };
  try {
    json = (await res.json()) as T & { status?: string; message?: string; code?: string };
  } catch {
    throw new PhotoUploadFailedError(`サーバーエラー (HTTP ${res.status})`);
  }
  if (json.status === 'error') {
    // json.code（例: ASSET_UNSUPPORTED_MIME_TYPE）をそのまま保持する。ここで捨てると
    // errorMapping側で恒久的失敗（MIME不一致）と一時的失敗（通信断・5xx等）を区別できなくなる
    throw new PhotoUploadFailedError(json.message || '処理に失敗しました', json.code);
  }
  return json;
}

export async function createOrReuseAsset(input: CreateAssetInput, idToken: string): Promise<CreateAssetResult> {
  const json = await postJson<CreateAssetResponse>(ASSETS_CREATE_URL, idToken, {
    requestId: input.requestId,
    fileHash: input.fileHash,
    originalFilename: input.originalFilename,
    mimeType: input.mimeType,
    sizeBytes: input.sizeBytes,
    width: input.width,
    height: input.height,
    takenAt: input.takenAt,
    exifGpsLat: input.exifGpsLat,
    exifGpsLng: input.exifGpsLng,
  });
  if (!json.assetId || json.assetStatus === undefined || json.uploadRequired === undefined) {
    throw new PhotoUploadFailedError('Asset作成の応答が不正です');
  }
  return {
    assetId: json.assetId,
    assetStatus: json.assetStatus,
    uploadRequired: json.uploadRequired,
    presignedUploadUrl: json.presignedUploadUrl,
    requiredHeaders: json.requiredHeaders,
  };
}

// base64（data URLプレフィックス無し）をArrayBufferへ戻し、presigned URLへ直接PUTする。
// Workerは画像binaryを一切中継しない（ブラウザ→R2直接）
export async function uploadOriginalToR2(base64: string, presignedUploadUrl: string, contentType: string): Promise<void> {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

  let res: Response;
  try {
    res = await fetch(presignedUploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': contentType },
      body: bytes,
    });
  } catch {
    throw new PhotoUploadFailedError('R2への写真アップロード通信に失敗しました');
  }
  if (!res.ok) {
    throw new PhotoUploadFailedError(`R2への写真アップロードに失敗しました (HTTP ${res.status})`);
  }
}

export async function finalizeAsset(assetId: string, idToken: string): Promise<void> {
  const json = await postJson<{ assetStatus?: string }>(assetFinalizeUrl(assetId), idToken, {});
  if (json.assetStatus !== 'ready') {
    throw new PhotoUploadFailedError('Assetのfinalizeに失敗しました');
  }
}

// Asset作成→（必要なら）R2アップロード→finalize、を1回で行う。既にassetIdが確定している場合は
// 呼び出し側でこの関数自体を呼ばない（再アップロードしない、という冪等性は呼び出し側=adapterが担保する）
export async function createUploadAndFinalizeAsset(
  input: CreateAssetInput,
  originalBase64: string,
  idToken: string,
): Promise<string> {
  const created = await createOrReuseAsset(input, idToken);
  if (created.uploadRequired) {
    if (!created.presignedUploadUrl) {
      throw new PhotoUploadFailedError('presigned URLが発行されませんでした');
    }
    await uploadOriginalToR2(originalBase64, created.presignedUploadUrl, input.mimeType);
    await finalizeAsset(created.assetId, idToken);
  }
  return created.assetId;
}
