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

// 発酵は食材ログの対象外（加工ログ側で扱う）
export const LARGE_CATEGORY_OPTIONS = [
  '植物', '魚介', '肉', '乳', 'キノコ', '海藻', 'その他',
] as const;

// 植物向け（既定・フォールバック）
export const PHASE_OPTIONS = [
  '新芽', '若葉', '蕾', '開花', '結実', '収穫', '枯れ', 'その他',
] as const;

// キノコ向け（大分類=キノコのときだけ使用）
export const MUSHROOM_PHASE_OPTIONS = [
  '発生（芽出し）', '幼菌', '生育中', '成菌（傘開き）', '胞子放出', '収穫', '枯れ・腐敗', 'その他',
] as const;

// 魚介向け
export const SEAFOOD_PHASE_OPTIONS = [
  '稚魚', '幼魚', '成魚', '産卵期', '旬', '水揚げ', '保存', 'その他',
] as const;

// 肉向け
export const MEAT_PHASE_OPTIONS = [
  '幼獣', '成獣', 'と畜', '熟成中', '精肉', '保存', 'その他',
] as const;

// 乳向け
export const DAIRY_PHASE_OPTIONS = [
  '搾乳', '生乳', '発酵中', '熟成中', '加工品', '保存', 'その他',
] as const;

// 海藻向け
export const SEAWEED_PHASE_OPTIONS = [
  '新芽', '生育中', '成熟', '胞子（開花）', '収穫', '乾燥', '枯れ', 'その他',
] as const;

// 大分類ごとの状態（フェーズ）選択肢を返す。専用の分類がない大分類は植物向けの一覧を流用する。
export function getPhaseOptions(largeCategory: string): readonly string[] {
  switch (largeCategory) {
    case 'キノコ': return MUSHROOM_PHASE_OPTIONS;
    case '魚介':   return SEAFOOD_PHASE_OPTIONS;
    case '肉':     return MEAT_PHASE_OPTIONS;
    case '乳':     return DAIRY_PHASE_OPTIONS;
    case '海藻':   return SEAWEED_PHASE_OPTIONS;
    default:       return PHASE_OPTIONS;
  }
}

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
