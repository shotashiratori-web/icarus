import { FIELD_CLOUDINARY_SIGNATURE_URL, FIELD_SUBMIT_D1_URL } from '../config';
import { TokenExpiredError } from './icarusApi';

// Cloudinaryアップロード段階の失敗を、D1保存段階の失敗と区別して呼び出し元(adapter)へ伝えるための専用エラー。
// 「写真のアップロードに失敗しました」という段階の明確な表示に使う
export class PhotoUploadFailedError extends Error {
  // APIレスポンスのcode（例: ASSET_UNSUPPORTED_MIME_TYPE）。errorMapping側で恒久的失敗か
  // 一時的失敗かを判定するために保持する。未指定（通信断・5xx等）ならundefinedのまま
  code?: string;
  constructor(message: string, code?: string) {
    super(message);
    this.name = 'PhotoUploadFailedError';
    this.code = code;
  }
}

interface CloudinarySignatureResponse {
  status: 'success' | 'error';
  message?: string;
  timestamp: number;
  signature: string;
  apiKey: string;
  cloudName: string;
  folder: string;
}

async function fetchCloudinarySignature(idToken: string): Promise<CloudinarySignatureResponse> {
  let res: Response;
  try {
    res = await fetch(FIELD_CLOUDINARY_SIGNATURE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
      body: JSON.stringify({ purpose: 'field-log' }),
    });
  } catch {
    throw new PhotoUploadFailedError('署名取得の通信に失敗しました');
  }
  if (res.status === 401) {
    throw new TokenExpiredError('ログインセッションが切れました。再度ログインしてください。');
  }
  let json: CloudinarySignatureResponse;
  try {
    json = (await res.json()) as CloudinarySignatureResponse;
  } catch {
    throw new PhotoUploadFailedError(`署名取得に失敗しました (HTTP ${res.status})`);
  }
  if (json.status !== 'success') {
    throw new PhotoUploadFailedError(json.message || '署名取得に失敗しました');
  }
  return json;
}

interface CloudinaryUploadResponse {
  secure_url?: string;
  error?: { message?: string };
}

// base64（data URLプレフィックス無し）のJPEGを、Worker発行の署名を使ってCloudinaryへ直接アップロードする。
// GASと同じ既存のresizeToJpeg()の出力をそのまま使うため、画像サイズ・形式の制約も既存経路と同等になる
async function uploadJpegBase64ToCloudinary(
  base64Jpeg: string,
  fileName: string,
  sig: CloudinarySignatureResponse,
): Promise<string> {
  const form = new FormData();
  form.append('file', `data:image/jpeg;base64,${base64Jpeg}`);
  form.append('api_key', sig.apiKey);
  form.append('timestamp', String(sig.timestamp));
  form.append('signature', sig.signature);
  form.append('folder', sig.folder);

  let res: Response;
  try {
    res = await fetch(`https://api.cloudinary.com/v1_1/${sig.cloudName}/image/upload`, {
      method: 'POST',
      body: form,
    });
  } catch {
    throw new PhotoUploadFailedError('写真のアップロード通信に失敗しました');
  }

  let json: CloudinaryUploadResponse;
  try {
    json = (await res.json()) as CloudinaryUploadResponse;
  } catch {
    throw new PhotoUploadFailedError('写真のアップロード応答の読み取りに失敗しました');
  }
  if (!res.ok || !json.secure_url) {
    throw new PhotoUploadFailedError(json.error?.message || `写真のアップロードに失敗しました (HTTP ${res.status}) [${fileName}]`);
  }
  return json.secure_url;
}

// 署名取得→Cloudinary直接アップロードを1回で行う。失敗時は必ずPhotoUploadFailedError（またはTokenExpiredError）を投げる
export async function uploadFieldLogPhoto(base64Jpeg: string, fileName: string, idToken: string): Promise<string> {
  const sig = await fetchCloudinarySignature(idToken);
  return uploadJpegBase64ToCloudinary(base64Jpeg, fileName, sig);
}

export interface FieldLogD1SubmitInput {
  eventId: string;
  requestId: string;
  date: string;
  food: string;
  place: string;
  memo: string;
  photoUrl: string; // 写真なしの場合は ''。assetId指定時は必ず''（Workerが両方の同時指定を拒否する）
  latitude?: number;
  longitude?: number;
  takenAt?: string;
  largeCategory?: string;
  // Photo Asset Architecture v1（Stage 1）。指定時、写真の実体はR2 Asset側にあり
  // photoUrlは''のまま送る（asset_linksが正本、Phase4原則）
  assetId?: string;
}

export interface FieldLogD1SubmitResult {
  eventId: string;
  requestId: string;
  photoUrl: string;
  duplicate: boolean;
}

interface FieldLogD1SubmitResponse {
  success?: boolean;
  status?: 'error';
  message?: string;
  eventId?: string;
  requestId?: string;
  photoUrl?: string;
  duplicate?: boolean;
}

// D1保存段階の失敗はPhotoUploadFailedErrorにせず通常のErrorとして投げる（adapter側で段階を区別する）
export async function submitFieldLogD1(input: FieldLogD1SubmitInput, idToken: string): Promise<FieldLogD1SubmitResult> {
  let res: Response;
  try {
    res = await fetch(FIELD_SUBMIT_D1_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
      body: JSON.stringify({
        eventId: input.eventId,
        requestId: input.requestId,
        date: input.date,
        food: input.food,
        place: input.place,
        memo: input.memo,
        photoUrl: input.photoUrl,
        latitude: input.latitude,
        longitude: input.longitude,
        takenAt: input.takenAt,
        largeCategory: input.largeCategory,
        assetId: input.assetId,
        clientVersion: 'icarus-web-unit-d',
      }),
    });
  } catch {
    throw new Error('ネットワークエラーが発生しました。通信状況を確認してください。');
  }

  if (res.status === 401) {
    throw new TokenExpiredError('ログインセッションが切れました。再度ログインしてください。');
  }

  let json: FieldLogD1SubmitResponse;
  try {
    json = (await res.json()) as FieldLogD1SubmitResponse;
  } catch {
    throw new Error(`サーバーエラー (HTTP ${res.status})`);
  }

  if (!json.success) {
    throw new Error(json.message || '保存に失敗しました');
  }

  return {
    eventId: json.eventId ?? input.eventId,
    requestId: json.requestId ?? input.requestId,
    photoUrl: json.photoUrl ?? input.photoUrl,
    duplicate: !!json.duplicate,
  };
}
