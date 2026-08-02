import type { FieldLogEntry } from '../types/zukan';

// GASの応答が間欠的に遅い・止まる問題（既知の不安定性）への対応。
// 直近の取得結果をlocalStorageへ保存し、次回はまずキャッシュを即表示してからバックグラウンドで
// 最新を取り直す。古いデータが一瞬見える可能性はあるが、GASが遅い間ずっと「読み込み中」で
// 何もできなくなるよりはましという判断。
const CACHE_KEY = 'icarus:field-log-cache';

interface FieldLogCache {
  entries: FieldLogEntry[];
  savedAt: number;
}

export function loadFieldLogCache(): FieldLogEntry[] | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed === 'object' && parsed !== null &&
      Array.isArray((parsed as FieldLogCache).entries) &&
      typeof (parsed as FieldLogCache).savedAt === 'number'
    ) {
      return (parsed as FieldLogCache).entries;
    }
    return null;
  } catch {
    return null;
  }
}

export function saveFieldLogCache(entries: FieldLogEntry[]): void {
  try {
    const cache: FieldLogCache = { entries, savedAt: Date.now() };
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
  } catch {
    // 保存できなくても致命的ではない（単にキャッシュが使えないだけ）
  }
}
