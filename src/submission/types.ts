export type SubmissionEntity = 'foodLog' | 'fieldLog' | 'fieldLogD1' | 'spot' | 'wine' | 'wineTastingNote' | 'wineTastingNotePhoto' | 'daily' | 'workLog' | 'explorationSession';

export const ENTITY_LABELS: Record<SubmissionEntity, string> = {
  foodLog: '食材ログ',
  fieldLog: 'フィールドログ',
  fieldLogD1: '食材ログ（新経路）',
  spot: 'スポット',
  wine: 'ワイン',
  // Tasting Note Persistence v1（Stage 1B）。Wine Entity（'wine'、図鑑）とは別物（ADR-0001）
  wineTastingNote: 'テイスティングノート',
  // Tasting Note Persistence v1（Stage 1D-B）。本文（wineTastingNote）とは別retry単位（非結合）
  wineTastingNotePhoto: 'テイスティングノート写真',
  daily: 'Daily',
  workLog: '作業ログ',
  // Exploration History（Stage 2）。GPX 原本は別の端末保存（icarus-exploration）にあり、ここには ID だけ
  explorationSession: '探索の記録（GPX）',
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
  | 'GPS_NOT_FOUND'
  // Stage 1A: Photo Asset APIがASSET_UNSUPPORTED_MIME_TYPE（例: HEIC/HEIF）で拒否した場合専用。
  // ファイル形式が原因の恒久的失敗であり、再送しても結果は変わらないためretryable:falseで扱う
  | 'UNSUPPORTED_MEDIA_TYPE'
  // Exploration History: サーバーが理由付きで断った（hash 不一致・GPX として読めない・探索日が必要など）。原本は端末に残る
  | 'GPX_REJECTED';

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
