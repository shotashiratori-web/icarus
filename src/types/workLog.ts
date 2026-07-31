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

// /work/search（Phase 1 第2段階）用。作業ID単位に集約済みの一覧項目
export interface WorkSearchItem {
  workId: string;
  title: string;
  type: string;
  startDate: string;
  lastUpdatedAt: string;
  representativePhotoUrl: string;
  photoCount: number;
  summary: string;
}

export interface WorkSearchParams {
  query?: string;
  dateStart?: string;
  dateEnd?: string;
  hasPhoto?: boolean;
  limit?: number;
  offset?: number;
}

export interface WorkSearchSuccess {
  status: 'success';
  items: WorkSearchItem[];
  totalCount: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}

export function nowLocalDatetimeString(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`;
}
