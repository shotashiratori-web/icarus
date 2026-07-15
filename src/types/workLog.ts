export const WORK_TYPE_OPTIONS = [
  '加工研究', '食材観察', '料理研究', '営業メモ', '設備メモ', 'その他',
] as const;

export type WorkFormMode = 'create' | 'append';

export interface WorkEntry {
  datetime: string;
  content: string;
  photoUrl: string;
  caption: string;
}

export interface WorkPhoto {
  datetime: string;
  photoUrl: string;
  caption: string;
}

export interface WorkDetail {
  workId: string;
  title: string;
  type: string;
  startDate: string;
  lastUpdated: string;
  photoUrl: string;
  photos: WorkPhoto[];
  entries: WorkEntry[];
}

export interface WorkSubmitPayload {
  requestId: string;
  action: WorkFormMode;
  workId?: string;
  title?: string;
  type?: string;
  content: string;
  datetime: string;
  photoBase64?: string;
  photoMimeType?: 'image/jpeg';
  caption?: string;
}

export interface WorkSubmitSuccess {
  status: 'success';
  workId: string;
  row: number | string;
  photoUrl: string;
  code?: 'ALREADY_PROCESSED';
}

export interface WorkSubmitError {
  status: 'error';
  message: string;
  code?: 'REQUEST_PROCESSING' | 'NOT_FOUND';
}

export interface WorkDetailSuccess {
  status: 'success';
  item: WorkDetail;
}

export function nowLocalDatetimeString(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`;
}
