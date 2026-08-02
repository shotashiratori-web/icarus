// フィールドログ編集の未保存下書き保護（Unit D-1・Unit E-1でfoodName/locationへ拡張）。
// 通信不安定な現場での入力消失を防ぐための安全機能であり、オフライン送信・同期機能ではない。

export interface FieldLogDraftChanges {
  memo?: string;
  foodName?: string;
  location?: string;
}

export interface FieldLogDraft {
  entryId: string;
  changes: FieldLogDraftChanges;
  savedAt: string; // ISO日時文字列。パース不能でも下書き自体は有効として扱う
}

const KEY_PREFIX = 'icarus:field-log-draft:';
const OLD_DRAFT_THRESHOLD_MS = 30 * 24 * 60 * 60 * 1000; // 30日

function draftKey(entryId: string): string {
  return `${KEY_PREFIX}${entryId}`;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

// 壊れたデータ・entryId不一致・型不一致はすべて例外にせずnullを返す
export function loadFieldLogDraft(entryId: string): FieldLogDraft | null {
  if (!entryId) return null;
  try {
    const raw = localStorage.getItem(draftKey(entryId));
    if (!raw) return null;

    const parsed: unknown = JSON.parse(raw);
    if (!isPlainObject(parsed)) return null;
    if (typeof parsed.entryId !== 'string' || parsed.entryId !== entryId) return null;
    if (!isPlainObject(parsed.changes)) return null;
    if (parsed.changes.memo !== undefined && typeof parsed.changes.memo !== 'string') return null;
    if (parsed.changes.foodName !== undefined && typeof parsed.changes.foodName !== 'string') return null;
    if (parsed.changes.location !== undefined && typeof parsed.changes.location !== 'string') return null;
    if (typeof parsed.savedAt !== 'string') return null;

    // 古いmemoのみの下書き（Unit D-1）もそのまま読み込める（foodName/locationが無くても壊れたデータ扱いにしない）
    const changes: FieldLogDraftChanges = {};
    if (typeof parsed.changes.memo === 'string') changes.memo = parsed.changes.memo;
    if (typeof parsed.changes.foodName === 'string') changes.foodName = parsed.changes.foodName;
    if (typeof parsed.changes.location === 'string') changes.location = parsed.changes.location;

    return { entryId: parsed.entryId, changes, savedAt: parsed.savedAt };
  } catch {
    return null;
  }
}

// 保存に成功したかどうかを返す（localStorageが使えない環境では false）。
// 呼び出し側はfalseの場合にユーザーへ一度だけ通知する。
export function saveFieldLogDraft(entryId: string, changes: FieldLogDraftChanges): boolean {
  if (!entryId) return false;
  try {
    const draft: FieldLogDraft = { entryId, changes, savedAt: new Date().toISOString() };
    localStorage.setItem(draftKey(entryId), JSON.stringify(draft));
    return true;
  } catch {
    return false;
  }
}

export function clearFieldLogDraft(entryId: string): void {
  if (!entryId) return;
  try {
    localStorage.removeItem(draftKey(entryId));
  } catch {
    // 削除できなくても致命的ではない
  }
}

// savedAtがパース不能な場合はnull（呼び出し側は日時表示だけ省略する）
function parseDraftSavedAt(savedAt: string): Date | null {
  const d = new Date(savedAt);
  return isNaN(d.getTime()) ? null : d;
}

// 日時が不明な場合は「古い」と判定しない（不明なだけであり、古いとは限らないため）
export function isOldDraft(savedAt: string): boolean {
  const d = parseDraftSavedAt(savedAt);
  if (!d) return false;
  return Date.now() - d.getTime() > OLD_DRAFT_THRESHOLD_MS;
}

export function formatDraftSavedAt(savedAt: string): string {
  const d = parseDraftSavedAt(savedAt);
  if (!d) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
