export interface FoodLogForm {
  date: string;
  food: string;
  phase: string;
  place: string;
  largeCategory: string;
  harvested: string;
  memo: string;
  photoFile: File | null;
  photoPreviewUrl: string;
  photoBase64: string;
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

export function emptyForm(): FoodLogForm {
  const now = new Date();
  const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  return {
    date,
    food: '',
    phase: '',
    place: '',
    largeCategory: '',
    harvested: '不明',
    memo: '',
    photoFile: null,
    photoPreviewUrl: '',
    photoBase64: '',
  };
}
