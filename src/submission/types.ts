export type SubmissionEntity = 'foodLog' | 'fieldLog' | 'fieldLogD1' | 'spot' | 'wine' | 'daily' | 'workLog';

export const ENTITY_LABELS: Record<SubmissionEntity, string> = {
  foodLog: '食材ログ',
  fieldLog: 'フィールドログ',
  fieldLogD1: '食材ログ（新経路）',
  spot: 'スポット',
  wine: 'ワイン',
  daily: 'Daily',
  workLog: '作業ログ',
};

// draft/sending はEntity側の画面状態が管理する。ここで永続化するのはpendingのみ(Phase1)。
// completedはqueueから削除されるので状態としては現れない。errorは将来のための予約で、Phase1では使わない。
export type SubmissionState = 'draft' | 'sending' | 'pending' | 'completed' | 'error';

export type ErrorCode =
  | 'HEADER_MISMATCH'
  | 'AUTH_EXPIRED'
  | 'NETWORK_ERROR'
  | 'SERVER_ERROR'
  | 'UPLOAD_FAILED'
  | 'IMAGE_PARSE_FAILED'
  | 'GPS_NOT_FOUND';

export interface SubmissionError {
  code: ErrorCode;
  title: string;
  description: string; // 利用者向けの保留理由
  retryable: boolean;
  technicalDetail?: string; // 開発者向け詳細
  timestamp: string;
  entity: SubmissionEntity;
  payloadId: string;
}

export interface SubmissionItem<TPayload = unknown> {
  id: string; // Entity側の冪等キー(Food Logはphoto.requestId)と一致させ、再送時も使い回す
  entity: SubmissionEntity;
  state: SubmissionState;
  payload: TPayload; // 送信直前の完成ペイロード。生のFile/Blobは入れない
  title: string;
  photoThumbnail?: string;
  displayDate?: string;
  createdAt: string;
  updatedAt: string;
  attempts: number;
  lastError?: SubmissionError;
}
