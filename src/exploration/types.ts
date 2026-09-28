// Exploration History（Stage 2 Web）の型。設計: icarus/docs/architecture/icarus_exploration_history_stage2_final_design.md

export type Purpose = 'maitake' | 'mushroom' | 'sansai' | 'scouting' | 'other' | 'unknown';
export const PURPOSE_LABEL: Record<Purpose, string> = {
  maitake: '舞茸探索',
  mushroom: 'きのこ全般',
  sansai: '山菜',
  scouting: '下見',
  other: 'その他',
  unknown: '不明',
};
export const PURPOSES: Purpose[] = ['maitake', 'mushroom', 'sansai', 'scouting', 'other', 'unknown'];

export type TargetResult = 'found' | 'not_found' | 'unknown';
export const RESULT_LABEL: Record<TargetResult, string> = { found: '見つかった', not_found: '見つからなかった', unknown: '未記入' };

export interface TargetInput {
  requestId: string;
  target: string;
  result: TargetResult;
  memo: string;
}

// 表示用の軌跡（セグメントごと）。[lat, lng]
export type TrackSegments = [number, number][][];

// 端末の段階（再開の位置）。「登録済み」は R2 の原本の hash 一致＋D1 の登録成立まで済んだ時だけ
//   saved        … 端末に保存しただけ（未送信）
//   gpx_uploaded … ① 原本をサーバーへ送り、サーバーの hash 照合が済んだ（原本送信済み）
//   registered   … ② D1 に登録され、応答の gpxSha256 が端末の値と一致した（登録済み）
// 「送信失敗」は段階ではなく、再送しても直らないエラー（lastError.retryable=false）が付いている状態。段階は失わない
export type PendingStage = 'saved' | 'gpx_uploaded' | 'registered';
export type DisplayStatus = 'unsent' | 'gpx_uploaded' | 'registered' | 'failed';
export const STATUS_LABEL: Record<DisplayStatus, string> = {
  unsent: '未送信',
  gpx_uploaded: '原本送信済み',
  registered: '登録済み',
  failed: '送信失敗',
};

export interface PendingError {
  code: string;
  message: string;
  retryable: boolean;
  at: string;
}

export interface PendingPreview {
  exploredOn: string | null; // JST。時刻の無い GPX は null
  startedAt: string | null;
  distanceM: number;
  pointCount: number;
  bbox: { south: number; north: number; west: number; east: number };
  trackName: string;
  track: TrackSegments;
}

export function displayStatus(p: { stage: PendingStage; lastError: PendingError | null }): DisplayStatus {
  if (p.stage === 'registered') return 'registered';
  if (p.lastError && !p.lastError.retryable) return 'failed';
  return p.stage === 'gpx_uploaded' ? 'gpx_uploaded' : 'unsent';
}

export interface PendingExploration {
  id: string; // 登録の requestId を兼ねる（再送で同じ値を使い、重複登録を防ぐ）
  fileName: string;
  gpx: ArrayBuffer; // 原本（無加工）。iOS の古い Safari の Blob 問題を避け ArrayBuffer で持つ
  sha256: string;
  bytes: number;
  explorerNames: string[];
  purpose: Purpose;
  memo: string;
  exploredOnManual: string | null;
  targets: TargetInput[];
  preview: PendingPreview;
  // GPX を選んだ時点で原本は保存する（下書き）。歩いた人・目的などを入れて「送信」を押すと true。false の間は自動送信しない
  ready: boolean;
  stage: PendingStage;
  sessionId: string | null;
  lastError: PendingError | null;
  attempts: number;
  createdAt: string;
  updatedAt: string;
  gpxUploadedAt: string | null;
  registeredAt: string | null;
}

// サーバーの探索の記録（API の item）
export interface ExplorationTarget {
  id: string;
  target: string;
  result: TargetResult;
  memo: string;
  status: string;
  createdByName: string;
  updatedAt: string;
}
export interface ExplorationSession {
  id: string;
  gpxSha256: string;
  gpxBytes: number;
  gpxTrackName: string;
  exploredOn: string;
  startedAt: string | null;
  endedAt: string | null;
  durationS: number | null;
  distanceM: number;
  bbox: { south: number; north: number; west: number; east: number };
  areaIds: string[];
  explorerNames: string[];
  purpose: Purpose;
  memo: string;
  source: string;
  status: string;
  createdByName: string;
  updatedAt: string;
  targets: ExplorationTarget[];
  fieldLogEventIds: string[];
}
