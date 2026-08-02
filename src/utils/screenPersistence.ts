import type { Screen } from '../App';

// リロード（誤操作・iOSでのバックグラウンド復帰時の自動再読み込み等）で常にHomeへ戻ってしまう問題への対応。
// タブを閉じるまでの間だけ現在の画面をsessionStorageへ保存し、リロード時に復元する。
// 明示的にタブを閉じた場合はHomeから始まる（永続化はしない）。
const SCREEN_STORAGE_KEY = 'icarus:current-screen';

// metaDebugはURL(?debug=meta)経由でのみ入る想定のため、リロード復元の対象から除外する
const NON_RESTORABLE_SCREEN_NAMES = new Set(['metaDebug']);

// Screen型に追加した画面は、ここにも追記しないと復元対象にならない（型不一致で復元しないより安全側に倒す）
const VALID_SCREEN_NAMES = new Set([
  'home', 'record', 'review', 'list', 'foodLog', 'pendingList', 'field', 'processing',
  'workDetail', 'workForm', 'staffApproval', 'daily', 'dailyAdmin', 'zukan',
  'zukanFieldMap', 'zukanFieldDetail', 'wineList', 'wineForm', 'wineDetail',
  'spotList', 'spotForm', 'spotDetail', 'photoBulkUpload', 'photoHashRepair',
  'fieldIncompleteList', 'fieldBulkOrganize',
]);

export function saveCurrentScreen(screen: Screen): void {
  if (NON_RESTORABLE_SCREEN_NAMES.has(screen.name)) return;
  try {
    sessionStorage.setItem(SCREEN_STORAGE_KEY, JSON.stringify(screen));
  } catch {
    // sessionStorageが使えなくても致命的ではない（リロード復元がされないだけ）
  }
}

export function loadStoredScreen(): Screen | null {
  try {
    const raw = sessionStorage.getItem(SCREEN_STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed === 'object' && parsed !== null &&
      'name' in parsed && typeof (parsed as { name: unknown }).name === 'string' &&
      VALID_SCREEN_NAMES.has((parsed as { name: string }).name)
    ) {
      return parsed as Screen;
    }
    return null;
  } catch {
    return null;
  }
}
