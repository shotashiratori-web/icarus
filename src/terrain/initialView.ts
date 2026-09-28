// 地形探索を開いた時の見え方（Terrain Stage 1 Gate の改善、2026-09-28）。山で開いてすぐ使えるように:
// - スマホ幅では条件パネルを閉じて開く（地図を画面いっぱいに）
// - 位置情報が許可済み、または前回「現在地を表示」を使っていたら、自動で現在地を取りに行き、現在地周辺から表示する
//   （許可を求めたことが無い人に、開いた瞬間に許可を求めない）

export const GPS_REMEMBER_KEY = 'icarus:terrain-gps';
export const PHONE_MAX_WIDTH = 600;

export function initialPanelOpen(viewportWidth: number): boolean {
  return viewportWidth > PHONE_MAX_WIDTH;
}

export type LocationPermission = 'granted' | 'prompt' | 'denied' | 'unknown';

export function shouldAutoLocate(permission: LocationPermission, rememberedOn: boolean): boolean {
  if (permission === 'denied') return false;
  return permission === 'granted' || rememberedOn;
}

export async function locationPermission(): Promise<LocationPermission> {
  try {
    const status = await navigator.permissions?.query({ name: 'geolocation' as PermissionName });
    return (status?.state as LocationPermission | undefined) ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

export function rememberGps(on: boolean): void {
  try {
    if (on) localStorage.setItem(GPS_REMEMBER_KEY, '1');
    else localStorage.removeItem(GPS_REMEMBER_KEY);
  } catch {
    /* 覚えられなくても動作に影響しない */
  }
}

export function gpsRemembered(): boolean {
  try {
    return localStorage.getItem(GPS_REMEMBER_KEY) === '1';
  } catch {
    return false;
  }
}

// 「表示中」の説明。保存済みの版と表示中の版が同じなら「端末に保存した版」
export function displayedSourceLabel(displayedVersion: string, savedVersion: string | null): string {
  return savedVersion === displayedVersion ? '端末に保存した版' : '取得した版（未保存）';
}

export function insideBounds(b: { south: number; north: number; west: number; east: number }, lat: number, lng: number): boolean {
  return lat >= b.south && lat <= b.north && lng >= b.west && lng <= b.east;
}
