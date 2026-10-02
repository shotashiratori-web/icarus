// Environment Spots（S3）の型。設計: icarus/docs/architecture/icarus_environment_spots_s3_final_design.md
// Spot =「この木（地形・その他）がここにある」という環境の事実。Observation =「いつ・何を目的に見て・どうだったか」

export type EnvType = 'tree' | 'terrain' | 'other';
export type LifeState = 'alive' | 'snag' | 'fallen' | 'na';
export type LocationSource = 'gps' | 'map';
export type PhotoMissingReason = 'dark' | 'danger' | 'camera' | 'other';
export type ObsResult = 'found' | 'not_found' | 'not_checked';
export type FoundStage = 'young' | 'prime' | 'old';

export const PHOTO_MISSING_LABEL: Record<PhotoMissingReason, string> = { dark: '暗い', danger: '危険で撮影不可', camera: 'カメラ不調', other: 'その他' };
export const RESULT_LABEL: Record<ObsResult, string> = { found: 'あり', not_found: 'なし', not_checked: '見ていない' };
export const STAGE_LABEL: Record<FoundStage, string> = { young: '幼菌', prime: '適期', old: '老成' };
export const LIFE_LABEL: Record<LifeState, string> = { alive: '生木', snag: '立枯れ', fallen: '倒木', na: '該当なし' };

// 現場の入力は大きなボタン 5 つ。保存は 種類（env_type）と 生死（life_state）の 2 列（UI と DB の構造は同じでなくてよい）
export type SpotKindChoice = 'alive' | 'snag' | 'fallen' | 'terrain' | 'other';
export const KIND_CHOICES: { id: SpotKindChoice; label: string; envType: EnvType; lifeState: LifeState }[] = [
  { id: 'alive', label: '生木', envType: 'tree', lifeState: 'alive' },
  { id: 'snag', label: '立枯れ', envType: 'tree', lifeState: 'snag' },
  { id: 'fallen', label: '倒木', envType: 'tree', lifeState: 'fallen' },
  { id: 'terrain', label: '地形', envType: 'terrain', lifeState: 'na' },
  { id: 'other', label: 'その他', envType: 'other', lifeState: 'na' },
];

export interface EnvSpeciesItem {
  id: string;
  kind: 'tree' | 'target';
  name: string;
  aliases: string[];
  isUnknown: boolean;
  isOther: boolean;
  sortOrder: number;
  status: string;
}

export interface SpotPhotoRef {
  assetId: string;
  thumbnailUrl?: string;
  detailUrl?: string;
}

export interface SpotObservation {
  id: string;
  observedAt: string;
  targetSpeciesId: string | null;
  target: string;
  targetText: string;
  result: ObsResult;
  foundStage: FoundStage | null;
  memo: string;
  status: string;
  createdByName: string;
  createdAt: string;
  updatedAt: string;
  photos?: SpotPhotoRef[];
}

export interface EnvironmentSpot {
  id: string;
  title: string;
  envType: EnvType;
  lifeState: LifeState;
  treeSpeciesId: string | null;
  treeSpecies: string | null;
  treeSpeciesText: string | null;
  dbhCm: number | null;
  decayClass: number | null;
  lat: number;
  lng: number;
  locationSource: LocationSource;
  gpsAccuracyM: number | null;
  photoMissingReason: PhotoMissingReason | null;
  photoMissingMemo: string | null;
  photos: SpotPhotoRef[];
  memo: string;
  terrain: Record<string, unknown> | null;
  observedAt: string | null;
  status: string;
  createdByName: string | null;
  createdAt: string;
  updatedAt: string;
  observations: SpotObservation[];
}

export interface SpotCreateBody {
  requestId: string;
  envType: EnvType;
  lifeState: LifeState;
  treeSpeciesId?: string | null;
  treeSpeciesText?: string | null;
  dbhCm?: number | null;
  decayClass?: number | null;
  lat: number;
  lng: number;
  locationSource: LocationSource;
  gpsAccuracyM?: number | null;
  photoAssetIds?: string[];
  photoMissingReason?: PhotoMissingReason | null;
  photoMissingMemo?: string | null;
  memo: string;
  observedAt: string;
  terrain?: Record<string, unknown> | null;
  // Field Log（環境）から Spot にした時の元の記録。Field Log は変えず関連（evidenceOf）だけ残る
  fieldLogEventId?: string | null;
}

export interface ObservationInput {
  observedAt: string;
  targetSpeciesId?: string | null;
  targetText?: string;
  result: ObsResult;
  foundStage?: FoundStage | null;
  memo: string;
}

export interface PendingError {
  code: string;
  message: string;
  retryable: boolean;
  at: string;
}

// 端末に保存した写真（未送信の原本）。送信して登録が済むまで消さない
export interface PendingPhoto {
  id: string; // = asset の requestId（冪等）
  name: string;
  type: string;
  data: ArrayBuffer | null; // 登録が済んだら null（原本は R2 にある）
  bytes: number;
  sha256: string;
  assetId: string | null;
}

// 段階: saved（端末に保存）→ photos_uploaded（写真が R2 に上がった）→ registered（D1 に登録）
export type SpotStage = 'saved' | 'photos_uploaded' | 'registered';

export interface PendingSpot {
  id: string; // = requestId
  body: Omit<SpotCreateBody, 'requestId' | 'photoAssetIds'>;
  photos: PendingPhoto[];
  stage: SpotStage;
  spotId: string | null;
  lastError: PendingError | null;
  attempts: number;
  createdAt: string;
  updatedAt: string;
  registeredAt: string | null;
}

export interface PendingObservation {
  id: string; // = requestId
  spotId: string | null; // 登録済みのスポット
  pendingSpotId: string | null; // 未登録のスポット（先にスポットを送ってから）
  input: ObservationInput;
  stage: 'saved' | 'registered';
  observationId: string | null;
  lastError: PendingError | null;
  attempts: number;
  createdAt: string;
  updatedAt: string;
}
