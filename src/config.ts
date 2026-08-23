export const WORKER_URL = 'https://icarus-api.shota-shiratori.workers.dev';
export const GOOGLE_CLIENT_ID =
  '1022257413413-1lvs3k00jv357ho9rfjqnjtruake985l.apps.googleusercontent.com';
export const GAS_PUBLIC_URL =
  'https://script.google.com/macros/s/AKfycbx4ezP4YYItTunIBXt9l9qbgR8wafUrJXJeU4CZbJQkfSHFT7-KGmA-WOSQQ5Zkm8kbvg/exec';

// フィールドマップはIcarus版に統一（[[icarus_field_map_unification_policy]]）。GAS版の?action=mapは使わない
export const FIELD_LOGS_GEOJSON_URL = `${GAS_PUBLIC_URL}?action=field_logs_geojson`;

export const FIELD_RECENT_URL = `${WORKER_URL}/field/recent`;
export const WORK_RECENT_URL = `${WORKER_URL}/work/recent`;
export const WORK_DETAIL_URL = `${WORKER_URL}/work/detail`;
export const WORK_SEARCH_URL = `${WORKER_URL}/work/search`;
export const WORK_SUBMIT_URL = `${WORKER_URL}/work`;
export const STAFF_ME_URL = `${WORKER_URL}/staff/me`;
export const STAFF_ROSTER_URL = `${WORKER_URL}/admin/staff`;
export const STAFF_APPROVE_URL = `${WORKER_URL}/admin/staff/approve`;
export const STAFF_UPDATE_URL = `${WORKER_URL}/admin/staff/update`;
export const STAFF_ROLE_URL = `${WORKER_URL}/admin/staff/role`;
export const STAFF_SUSPEND_URL = `${WORKER_URL}/admin/staff/suspend`;
export const STAFF_REACTIVATE_URL = `${WORKER_URL}/admin/staff/reactivate`;
export const DAILY_TODAY_URL = `${WORKER_URL}/daily/today`;
export const DAILY_SUBMIT_URL = `${WORKER_URL}/daily/submit`;
export const DAILY_ADMIN_LIST_URL = `${WORKER_URL}/admin/daily`;
export const DAILY_ADMIN_COMMENT_URL = `${WORKER_URL}/admin/daily/comment`;
export const DAILY_ADMIN_CONFIRM_URL = `${WORKER_URL}/admin/daily/confirm`;
export const DAILY_ADMIN_REQUEST_MORE_URL = `${WORKER_URL}/admin/daily/request-more`;
export const WINES_URL = `${WORKER_URL}/wines`;
// Phase3: 食材図鑑（field_log_entriesをfoodでGROUP BYした読み取り専用API）
export const FIELD_FOODS_URL = `${WORKER_URL}/field/foods`;
export const FIELD_FOOD_DETAIL_URL = `${WORKER_URL}/field/foods/detail`;
export const SPOTS_URL = `${WORKER_URL}/spots`;
// Food/Process/ProcessedProduct Knowledge Entity MVP（migration 0011）。GETはActive Staff、POST/PATCHはAdmin限定
export const FOODS_URL = `${WORKER_URL}/foods`;
export const PROCESSES_URL = `${WORKER_URL}/processes`;
export const PROCESSED_PRODUCTS_URL = `${WORKER_URL}/processed-products`;
export const KNOWLEDGE_RELATIONS_URL = `${WORKER_URL}/knowledge-relations`;
// Composite API（migration不要、既存Food/Process/ProcessedProduct/KnowledgeRelationとは別ルート）。Admin限定
export const KNOWLEDGE_PROCESSES_URL = `${WORKER_URL}/knowledge/processes`;
export const AUTH_SESSION_URL = `${WORKER_URL}/auth/session`;
export const PHOTO_HASH_CHECK_URL = `${WORKER_URL}/photo-hashes/check`;
export const PHOTO_HASH_REGISTER_URL = `${WORKER_URL}/photo-hashes/register`;
export const FIELD_DELETE_ENTRIES_URL = `${WORKER_URL}/field/delete-entries`;
export const FIELD_UPDATE_ENTRY_URL = `${WORKER_URL}/field/update-entry`;
export const FIELD_CLASSIFY_PHOTO_URL = `${WORKER_URL}/field/classify-photo`;

// Unit D: Worker+D1新経路（新規フィールドログ送信のみが対象。編集・削除・一般スタッフは既存GAS経路のまま）
export const FIELD_CLOUDINARY_SIGNATURE_URL = `${WORKER_URL}/field/cloudinary-signature`;
export const FIELD_SUBMIT_D1_URL = `${WORKER_URL}/field/submit-d1`;

// 新経路（D1保存）を使う管理者アカウントの許可リスト。ここを空にするだけで全員が既存GAS経路へ戻る（切り戻し）。
// クライアント側の判定だけに頼らず、/field/submit-d1・/field/cloudinary-signature側の管理者限定チェックも維持している
export const FIELD_LOG_D1_ENABLED_STAFF: string[] = [
  'shota.shiratori@liftup-power.co',
];

// Photo Asset Architecture v1（Stage 1: Admin Field Log R2 MVP）。既存Cloudinary経路（signed upload、
// FIELD_CLOUDINARY_SIGNATURE_URL）はコードごと残したまま、この値をfalseにするだけで旧経路へ戻せる
// （汎用feature flag基盤は作らない、という設計判断どおりの単純なスイッチ）
export const PHOTO_ASSET_R2_ENABLED = true;
export const ASSETS_CREATE_URL = `${WORKER_URL}/assets`;
export function assetFinalizeUrl(assetId: string): string {
  return `${WORKER_URL}/assets/${encodeURIComponent(assetId)}/finalize`;
}
