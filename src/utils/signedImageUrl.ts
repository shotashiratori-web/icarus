import type { FieldLogEntry } from '../types/zukan';

// 写真の署名付きURL（icarus-api /assets/:id/image?variant=…&expires=<UNIX秒>&signature=…）の期限判定。
// 期限はサーバー側で「+24時間以降の最初のJST 0時」（assetImageUrl.ts）。端末キャッシュに残ったURLは
// 期限を過ぎると403になり、画面に壊れた画像が並ぶ（Field Map Stale Cache、2026-09-27）

// expires が無いURL（旧Cloudinary・恒久viewURLなど）は期限なしとして null
export function signedUrlExpiresAtMs(url: string): number | null {
  if (!url) return null;
  try {
    const raw = new URL(url).searchParams.get('expires');
    if (!raw || !/^\d+$/.test(raw)) return null;
    return Number(raw) * 1000;
  } catch {
    return null;
  }
}

// 期限切れ（または期限まで marginMs 未満）なら true。表示中に切れるのを避けるため少し余裕を持たせる
export function isSignedUrlExpired(url: string, nowMs: number, marginMs = 60_000): boolean {
  const exp = signedUrlExpiresAtMs(url);
  return exp !== null && exp - marginMs <= nowMs;
}

// 記録データは残したまま、写真URLの期限だけを見て imageExpired を付け直す（記録全体は捨てない）
export function markExpiredImages(entries: FieldLogEntry[], nowMs: number): FieldLogEntry[] {
  return entries.map((e) => {
    const expired = isSignedUrlExpired(e.thumbnailUrl ?? '', nowMs) || isSignedUrlExpired(e.photoUrl, nowMs);
    if (expired === !!e.imageExpired) return e;
    return expired ? { ...e, imageExpired: true } : { ...e, imageExpired: false };
  });
}
