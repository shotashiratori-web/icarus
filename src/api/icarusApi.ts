import { parse as parseExif, gps as parseExifGps } from 'exifr';
import { WORKER_URL, GAS_PUBLIC_URL, PHOTO_HASH_CHECK_URL, PHOTO_HASH_REGISTER_URL } from '../config';
import type { PhotoEntry, CommonFields, FoodLogSuccess, FoodLogApiError, FoodCandidate } from '../types/foodLog';

export async function extractExifDate(file: File): Promise<{ date: string; takenAt: string } | null> {
  try {
    const exif = await parseExif(file, { pick: ['DateTimeOriginal', 'CreateDate', 'DateTime'] });
    const raw: unknown = exif?.DateTimeOriginal ?? exif?.CreateDate ?? exif?.DateTime;
    if (!raw) return null;
    const d = raw instanceof Date ? raw : new Date(raw as string);
    if (isNaN(d.getTime())) return null;
    const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    return { date, takenAt: d.toISOString() };
  } catch {
    return null;
  }
}

// 写真自体に埋め込まれた撮影地点（EXIF GPSタグ）を読む。無ければnull（ライブ位置情報へのフォールバックは呼び出し側で行う）
export async function extractExifGps(file: File): Promise<{ lat: number; lng: number } | null> {
  try {
    const coords = await parseExifGps(file);
    if (!coords || typeof coords.latitude !== 'number' || typeof coords.longitude !== 'number') return null;
    return { lat: coords.latitude, lng: coords.longitude };
  } catch {
    return null;
  }
}

export class TokenExpiredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TokenExpiredError';
  }
}

export async function submitPhotoEntry(
  photo: PhotoEntry,
  common: CommonFields,
  idToken: string,
): Promise<FoodLogSuccess> {
  let res: Response;
  try {
    res = await fetch(WORKER_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify({
        requestId: photo.requestId,
        recordType: 'food',
        clientVersion: '2.0.0',
        date: photo.date,
        food: photo.food,
        foodId: photo.foodId,
        phase: photo.phase,
        place: common.place,
        largeCategory: common.largeCategory,
        harvested: common.harvested,
        memo: photo.memo,
        photoBase64: photo.base64,
        photoMimeType: 'image/jpeg',
        latitude: photo.gps?.lat,
        longitude: photo.gps?.lng,
        gpsAccuracy: photo.gps?.accuracy,
        takenAt: photo.takenAt,
        fileHash: photo.fileHash,
        fileName: photo.fileName,
      }),
    });
  } catch {
    throw new Error('ネットワークエラーが発生しました。通信状況を確認してください。');
  }

  if (res.status === 401) {
    throw new TokenExpiredError('ログインセッションが切れました。再度ログインしてください。');
  }

  let json: FoodLogSuccess | FoodLogApiError;
  try {
    json = (await res.json()) as FoodLogSuccess | FoodLogApiError;
  } catch {
    throw new Error(`サーバーエラー (HTTP ${res.status})`);
  }

  if (json.status !== 'success') {
    throw new Error((json as FoodLogApiError).message || '送信に失敗しました');
  }

  return json as FoodLogSuccess;
}

// 重複写真チェック用。元ファイル（リサイズ前）のバイト列からSHA-256を計算する
export async function sha256Hex(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

const PHOTO_HASH_CHECK_CHUNK_SIZE = 200; // サーバー側の上限と合わせる。将来数千件規模でも同じAPIをチャンクして呼ぶだけで対応できる

// サーバーに既に登録済みのハッシュ集合を返す。200件ずつチャンクして問い合わせる
export async function checkPhotoHashes(hashes: string[], idToken: string): Promise<Set<string>> {
  const existing = new Set<string>();
  for (let i = 0; i < hashes.length; i += PHOTO_HASH_CHECK_CHUNK_SIZE) {
    const chunk = hashes.slice(i, i + PHOTO_HASH_CHECK_CHUNK_SIZE);
    const res = await fetch(PHOTO_HASH_CHECK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify({ hashes: chunk }),
    });
    if (!res.ok) throw new Error(`重複チェックに失敗しました (HTTP ${res.status})`);
    const json = (await res.json()) as { status: string; existing?: string[] };
    if (json.status !== 'success' || !Array.isArray(json.existing)) {
      throw new Error('重複チェックのレスポンスが不正です');
    }
    for (const h of json.existing) existing.add(h);
  }
  return existing;
}

export interface PhotoHashRegisterResult {
  registered: number;
  alreadyExisting: number;
  failed: number;
}

// 補完登録専用（管理者限定）。Food Log再送信は発生しない。200件ずつチャンクして呼ぶ
export async function registerPhotoHashes(
  items: { hash: string; fileName: string }[],
  idToken: string,
): Promise<PhotoHashRegisterResult> {
  const total: PhotoHashRegisterResult = { registered: 0, alreadyExisting: 0, failed: 0 };
  for (let i = 0; i < items.length; i += PHOTO_HASH_CHECK_CHUNK_SIZE) {
    const chunk = items.slice(i, i + PHOTO_HASH_CHECK_CHUNK_SIZE);
    const res = await fetch(PHOTO_HASH_REGISTER_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify({ items: chunk }),
    });
    if (!res.ok) throw new Error(`補完登録に失敗しました (HTTP ${res.status})`);
    const json = (await res.json()) as { status: string } & Partial<PhotoHashRegisterResult>;
    if (json.status !== 'success' || typeof json.registered !== 'number') {
      throw new Error('補完登録のレスポンスが不正です');
    }
    total.registered += json.registered;
    total.alreadyExisting += json.alreadyExisting ?? 0;
    total.failed += json.failed ?? 0;
  }
  return total;
}

export async function fetchFoodCandidates(): Promise<FoodCandidate[]> {
  try {
    const url = `${GAS_PUBLIC_URL}?action=food_candidates`;
    const res = await fetch(url);
    if (!res.ok) return [];
    const data = await res.json() as FoodCandidate[];
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

function getPositionOnce(options: PositionOptions): Promise<GeolocationPosition | null> {
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve(pos),
      () => resolve(null),
      options,
    );
  });
}

export async function fetchGps(): Promise<{ lat: number; lng: number; accuracy: number } | null> {
  if (!navigator.geolocation) return null;
  const options: PositionOptions = { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 };
  // 屋外での取得失敗（電波待ち・タイムアウト）に備え、1回失敗しても自動でもう一度だけ試す
  const pos = (await getPositionOnce(options)) ?? (await getPositionOnce(options));
  if (!pos) return null;
  return { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy };
}

// ChromeなどはHEIC/HEIFをnew Image()/canvasでネイティブデコードできないため、
// resizeToJpeg()へ渡す前にJPEGへ変換しておく必要がある。判定は拡張子とMIME type両方を見る
// （PCの設定によりFile.typeが空文字になることがあるため、拡張子だけでは取りこぼす場合がある）
export function isHeicFile(file: File): boolean {
  const name = file.name.toLowerCase();
  const type = file.type.toLowerCase();
  return name.endsWith('.heic') || name.endsWith('.heif')
    || type === 'image/heic' || type === 'image/heif';
}

// heic2any（WASM同梱）は実際にHEICファイルに遭遇したときだけ読み込む
export async function convertHeicToJpeg(file: File): Promise<File> {
  const { default: heic2any } = await import('heic2any');
  const result = await heic2any({ blob: file, toType: 'image/jpeg', quality: 0.9 });
  const blob = Array.isArray(result) ? result[0] : result;
  const jpegName = file.name.replace(/\.(heic|heif)$/i, '.jpg');
  return new File([blob], jpegName, { type: 'image/jpeg' });
}

export async function resizeToJpeg(
  file: File,
  maxPx = 2048,
  quality = 0.8,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      const { naturalWidth: w, naturalHeight: h } = img;
      const scale = Math.min(1, maxPx / Math.max(w, h));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(w * scale);
      canvas.height = Math.round(h * scale);
      const ctx = canvas.getContext('2d');
      if (!ctx) return reject(new Error('Canvas context unavailable'));
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      canvas.toBlob(
        (blob) => {
          if (!blob) return reject(new Error('画像の変換に失敗しました'));
          const reader = new FileReader();
          reader.onload = () => {
            const dataUrl = reader.result as string;
            resolve(dataUrl.split(',')[1]);
          };
          reader.onerror = () => reject(new Error('画像の読み込みに失敗しました'));
          reader.readAsDataURL(blob);
        },
        'image/jpeg',
        quality,
      );
    };
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('画像を開けませんでした'));
    };
    img.src = objectUrl;
  });
}

// Photo Asset Architecture v1（Stage 1）専用。resize前の元Fileそのものをbase64化する
// （resizeToJpeg()はcanvas再描画でリサイズ後JPEGを返すが、こちらは一切変換しない）
export function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as string).split(',')[1]);
    reader.onerror = () => reject(new Error('画像の読み込みに失敗しました'));
    reader.readAsDataURL(file);
  });
}

// Photo Asset Architecture v1（Stage 1）専用。元Fileの実寸法を取得する（resizeはしない）。
// HEICはブラウザによってはデコードできない（Safari/iOSは可、多くのデスクトップChromeは不可）ため、
// 取得できなければnullを返す（widthEmpty/height省略はD1スキーマ上nullable、致命的ではない）
export function getImageDimensions(file: File): Promise<{ width: number; height: number } | null> {
  return new Promise((resolve) => {
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve({ width: img.naturalWidth, height: img.naturalHeight });
    };
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(null);
    };
    img.src = objectUrl;
  });
}
