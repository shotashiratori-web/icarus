// 作業ログの写真の準備（icarus_work_log_photo_r2_design.md）。新しい作業の画面と棚卸しモードで共用する。
// 縮小 JPEG（プレビュー・原本を使えない時の代わり）と、原本（縮小・変換なし）を作る
import { resizeToJpeg, readFileAsBase64, sha256Hex, getImageDimensions, extractExifDate, isHeicFile } from '../api/icarusApi';
import { WORK_LOG_PHOTO_R2_ENABLED } from '../config';
import type { WorkLogPhotoOriginal } from '../db/localDB';

// R2（POST /assets）が受け付ける形式。それ以外（PNG のスクリーンショット等）は縮小 JPEG を原本の代わりにする
export function originalMimeType(file: File): string | null {
  if (isHeicFile(file)) return 'image/heic';
  if (file.type === 'image/jpeg' || file.type === 'image/heif') return file.type;
  if (!file.type && /\.jpe?g$/i.test(file.name)) return 'image/jpeg';
  return null;
}

async function sha256HexOfBase64(base64: string): Promise<string> {
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

// 撮ったままのファイルを、縮小も変換もせずに持つ
export async function prepareOriginal(file: File, resizedBase64: string): Promise<WorkLogPhotoOriginal> {
  const mime = originalMimeType(file);
  if (!mime) {
    return {
      assetRequestId: crypto.randomUUID(),
      base64: resizedBase64, mimeType: 'image/jpeg', fileHash: await sha256HexOfBase64(resizedBase64),
      sizeBytes: Math.floor((resizedBase64.length * 3) / 4), fileName: file.name.replace(/\.[^.]+$/, '') + '.jpg',
    };
  }
  const [base64, fileHash, dims, exif] = await Promise.all([
    readFileAsBase64(file), sha256Hex(file), getImageDimensions(file), extractExifDate(file),
  ]);
  return {
    assetRequestId: crypto.randomUUID(),
    base64, mimeType: mime, fileHash, sizeBytes: file.size,
    width: dims?.width, height: dims?.height, takenAt: exif?.takenAt, fileName: file.name || 'photo.jpg',
  };
}

export interface PreparedWorkLogPhoto {
  previewBase64: string;
  original?: WorkLogPhotoOriginal;
}

export async function prepareWorkLogPhoto(file: File): Promise<PreparedWorkLogPhoto> {
  const previewBase64 = await resizeToJpeg(file);
  const original = WORK_LOG_PHOTO_R2_ENABLED ? await prepareOriginal(file, previewBase64) : undefined;
  return { previewBase64, original };
}
