// 探索履歴（GPX）の線の見た目。細い青＋細い白縁（2026-10-09 比較のパターン C）。
// 白縁 = 森林の上で消えない・地図の河川（濃紺、縁なし）と見分ける。細い青 = 下の道（白縁＋色）が横に読める
// 押せる幅は白縁の線で取る（細い青だけだと押しにくい）。車の区間の除外はここでは扱わない（速度判定の Backlog）
export const TRACK_COLOR = '#1a73e8';
export const TRACK_CASING = { color: '#fff', weight: 4.5, opacity: 0.85 } as const;
export const TRACK_LINE = { color: TRACK_COLOR, weight: 2.5, opacity: 1 } as const;
export const TRACK_UNSENT_DASH = '8 6'; // 端末にだけある（未送信）の記録
