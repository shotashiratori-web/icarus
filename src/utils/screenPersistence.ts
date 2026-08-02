import type { Screen } from '../App';

// リロード（誤操作・iOSでのバックグラウンド復帰時の自動再読み込み・ホーム画面アイコンからの再起動等）で
// 常にHomeへ戻ってしまう問題への対応。現在の画面をlocalStorageへ保存し、次回読み込み時に復元する。
// sessionStorageではなくlocalStorageを使うのは、iOSでホーム画面に追加したPWAをアイコンから開き直した場合、
// タブを閉じた場合と区別がつかず新しいセッション扱いになることがあるため（sessionStorageが引き継がれない）。
// Homeへ明示的に戻ってから離れた場合はHomeから再開される。
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
    localStorage.setItem(SCREEN_STORAGE_KEY, JSON.stringify(screen));
  } catch {
    // localStorageが使えなくても致命的ではない（リロード復元がされないだけ）
  }
}

export function loadStoredScreen(): Screen | null {
  try {
    const raw = localStorage.getItem(SCREEN_STORAGE_KEY);
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
