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
