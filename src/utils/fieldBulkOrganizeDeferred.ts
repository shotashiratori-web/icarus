// 一括写真の整理まわりで、食材名が空欄のままでも「未整理」として毎回出てこさせたくない
// 写真を管理する。2種類ある：
// - 後で整理（deferred）: 一覧からは外さず、並び順の最後に回す（いずれは対応してもらう）
// - スポット登録済み（excluded）: 食材ログとしては扱わないものなので、一覧・件数から完全に除外する

const DEFERRED_KEY = 'icarus:field-bulk-organize-deferred';
const EXCLUDED_KEY = 'icarus:field-bulk-organize-excluded';

function loadSet(key: string): Set<string> {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return new Set();
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((v): v is string => typeof v === 'string'));
  } catch {
    return new Set();
  }
}

function saveSet(key: string, ids: Set<string>): void {
  try {
    localStorage.setItem(key, JSON.stringify([...ids]));
  } catch {
    // 保存できなくても致命的ではない（次回また対象として出てくるだけ）
  }
}

export function loadDeferredIds(): Set<string> {
  return loadSet(DEFERRED_KEY);
}

export function addDeferredId(eventId: string): void {
  if (!eventId) return;
  const ids = loadSet(DEFERRED_KEY);
  if (ids.has(eventId)) return;
  ids.add(eventId);
  saveSet(DEFERRED_KEY, ids);
}

// 食材名が入力されて完了した写真は、二度と対象にならないので掃除しておく
export function removeDeferredId(eventId: string): void {
  if (!eventId) return;
  const ids = loadSet(DEFERRED_KEY);
  if (!ids.has(eventId)) return;
  ids.delete(eventId);
  saveSet(DEFERRED_KEY, ids);
}

export function loadExcludedIds(): Set<string> {
  return loadSet(EXCLUDED_KEY);
}

export function addExcludedId(eventId: string): void {
  if (!eventId) return;
  const ids = loadSet(EXCLUDED_KEY);
  if (ids.has(eventId)) return;
  ids.add(eventId);
  saveSet(EXCLUDED_KEY, ids);
  // 後で整理リストに残っていても意味がないので、そちらからも消しておく
  removeDeferredId(eventId);
}
