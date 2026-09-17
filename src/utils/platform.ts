// iOS上のブラウザ判定（icarus_oauth2_popup_login_audit.md 7-1参照）。
// ITP（Intelligent Tracking Prevention）はSafariというアプリ固有の機能ではなく、iOS上の
// WebKitエンジン自体の制約であり、iOS上のChrome/Firefox等（Appleのポリシーによりレンダリング
// エンジンは同じくWebKit）も同様の制約を受けうる。そのため"Safari"という文字列ではなく、
// デバイスがiOSかどうかで判定する。
//
// iPadOS 13以降はデフォルトでUser-Agentを"Macintosh"（デスクトップ）と偽装するため、
// タッチ対応点数で判定を補う（一般的な回避策）。
export function isIOSDevice(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  if (/iPad|iPhone|iPod/.test(ua)) return true;
  return navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
}
