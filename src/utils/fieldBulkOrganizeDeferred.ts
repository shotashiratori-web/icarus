// 一括写真の整理で「後で整理」を選んだ、または「スポットとして登録」した写真は、
// 食材名が空欄のままなので毎回セッションの先頭付近に出てきてしまう（ユーザー報告あり）。
// 「後で」は「二度と出さない」ではないため一覧からは除外せず、並び順の最後に回すことで
// 毎回同じ写真を繰り返し確認させられる負担を減らす。

const KEY = 'icarus:field-bulk-organize-deferred';

function loadSet(): Set<string> {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return new Set();
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((v): v is string => typeof v === 'string'));
  } catch {
    return new Set();
  }
}

function saveSet(ids: Set<string>): void {
  try {
    localStorage.setItem(KEY, JSON.stringify([...ids]));
  } catch {
    // 保存できなくても致命的ではない（次回また先頭付近に出てくるだけ）
  }
}

export function loadDeferredIds(): Set<string> {
  return loadSet();
}

export function addDeferredId(eventId: string): void {
  if (!eventId) return;
  const ids = loadSet();
  if (ids.has(eventId)) return;
  ids.add(eventId);
  saveSet(ids);
}

// 食材名が入力されて完了した写真は、二度と対象にならないので掃除しておく
export function removeDeferredId(eventId: string): void {
  if (!eventId) return;
  const ids = loadSet();
  if (!ids.has(eventId)) return;
  ids.delete(eventId);
  saveSet(ids);
}
