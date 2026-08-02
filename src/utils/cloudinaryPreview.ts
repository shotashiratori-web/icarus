// 通信が不安定な現場での利用を想定し、一覧・連続整理画面のプレビューは元画像より軽いサイズを要求する。
// 元のURL（フルサイズ）は「元の写真を開く」等、詳細確認用に別途保持しておくこと。
export function getSmallPreviewUrl(url: string, maxSize = 800, quality = 60): string {
  if (!url) return url;
  return url.replace(/w_\d+,h_\d+,q_\d+/, `w_${maxSize},h_${maxSize},q_${quality}`);
}
