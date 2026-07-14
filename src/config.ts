export const WORKER_URL = 'https://icarus-api.shota-shiratori.workers.dev';
export const GOOGLE_CLIENT_ID =
  '1022257413413-1lvs3k00jv357ho9rfjqnjtruake985l.apps.googleusercontent.com';
export const GAS_PUBLIC_URL =
  'https://script.google.com/macros/s/AKfycbx4ezP4YYItTunIBXt9l9qbgR8wafUrJXJeU4CZbJQkfSHFT7-KGmA-WOSQQ5Zkm8kbvg/exec';

// 既存フィールドマップ（本体は変更しない、通常遷移のみ）
export const FIELD_MAP_URL = `${GAS_PUBLIC_URL}?action=map`;

export const FIELD_RECENT_URL = `${WORKER_URL}/field/recent`;
export const WORK_RECENT_URL = `${WORKER_URL}/work/recent`;
