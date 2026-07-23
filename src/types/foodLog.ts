export interface PhotoEntry {
  localId: string;
  requestId: string;
  previewUrl: string;
  base64: string;
  date: string;
  food: string;
  foodId?: string;
  phase: string;
  memo: string;
  gps?: { lat: number; lng: number; accuracy: number };
  takenAt?: string;
  // 「一件ずつ送信」モードでのみ使用（写真ごとに大分類・場所・採取有無を持つ）
  largeCategory?: string;
  place?: string;
  harvested?: string;
}

export type SubmitMode = 'batch' | 'individual';

export interface CommonFields {
  largeCategory: string;
  place: string;
  harvested: string;
}

export interface FoodCandidate {
  name: string;
  category: string;
}

export type PhotoSendStatus = 'pending' | 'sending' | 'success' | 'error';

export interface PhotoSendResult {
  photoIndex: number;
  status: PhotoSendStatus;
  result?: FoodLogSuccess;
  error?: string;
}

export interface FoodLogSuccess {
  status: 'success';
  requestId: string;
  row: number;
  eventId: string;
  food: string;
  photoUrl: string;
  replayed?: boolean;
  code?: string;
}

export interface FoodLogApiError {
  status: 'error';
  message: string;
}

export const LARGE_CATEGORY_OPTIONS = [
  '植物', '魚介', '肉', '乳', 'キノコ', '海藻', '発酵', 'その他',
] as const;

export const PHASE_OPTIONS = [
  '新芽', '若葉', '蕾', '開花', '結実', '収穫', '枯れ', 'その他',
] as const;

export const HARVESTED_OPTIONS = ['あり', 'なし', '不明'] as const;

export const MAX_PHOTOS = 5;

export function emptyCommonFields(): CommonFields {
  return { largeCategory: '', place: '', harvested: '不明' };
}

export function emptyPhotoEntry(): PhotoEntry {
  return {
    localId: crypto.randomUUID(),
    requestId: crypto.randomUUID(),
    previewUrl: '',
    base64: '',
    date: '',
    food: '',
    phase: '',
    memo: '',
  };
}

export function todayString(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}
