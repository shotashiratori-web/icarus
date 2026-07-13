import { WORKER_URL, GAS_PUBLIC_URL } from '../config';
import type { PhotoEntry, CommonFields, FoodLogSuccess, FoodLogApiError, FoodCandidate } from '../types/foodLog';

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
        date: common.date,
        food: photo.food,
        foodId: photo.foodId,
        phase: photo.phase,
        place: common.place,
        largeCategory: common.largeCategory,
        harvested: common.harvested,
        memo: photo.memo,
        photoBase64: photo.base64,
        photoMimeType: 'image/jpeg',
        gps: photo.gps,
        takenAt: photo.takenAt,
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

export async function fetchGps(): Promise<{ lat: number; lng: number; accuracy: number } | null> {
  if (!navigator.geolocation) return null;
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy }),
      () => resolve(null),
      { timeout: 8000, maximumAge: 60000 },
    );
  });
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
