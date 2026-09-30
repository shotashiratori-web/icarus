import { parse as parseExif } from 'exifr';

// 撮った写真（ライブラリから選んだ写真）の撮影時の位置と日時（EXIF）。山から戻ってから記録する時に使う。
// 位置は撮影時の GPS（location_source = gps）。精度は iPhone が書く GPSHPositioningError があれば使う（無ければ不明）

export interface PhotoMeta {
  lat: number | null;
  lng: number | null;
  accuracyM: number | null;
  takenAt: string | null; // ISO（端末のタイムゾーンで解釈した撮影日時）
}

export async function readPhotoMeta(file: File): Promise<PhotoMeta> {
  try {
    const e = await parseExif(file, { gps: true, pick: ['latitude', 'longitude', 'GPSHPositioningError', 'DateTimeOriginal', 'CreateDate', 'GPSLatitude', 'GPSLongitude', 'GPSLatitudeRef', 'GPSLongitudeRef'] }) as Record<string, unknown> | undefined;
    const lat = typeof e?.latitude === 'number' ? e.latitude : null;
    const lng = typeof e?.longitude === 'number' ? e.longitude : null;
    const hpe = typeof e?.GPSHPositioningError === 'number' ? e.GPSHPositioningError : null;
    const raw = e?.DateTimeOriginal ?? e?.CreateDate;
    const d = raw instanceof Date ? raw : raw ? new Date(String(raw)) : null;
    return { lat, lng, accuracyM: hpe, takenAt: d && !Number.isNaN(d.getTime()) ? d.toISOString() : null };
  } catch {
    return { lat: null, lng: null, accuracyM: null, takenAt: null };
  }
}

// よく使う樹種（この端末での記録回数）。候補の並べ替えだけに使う
const USAGE_KEY = 'icarus:spot-species-usage';
export function speciesUsage(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(USAGE_KEY) ?? '{}') as Record<string, number>;
  } catch {
    return {};
  }
}
export function countSpeciesUse(id: string): void {
  try {
    const u = speciesUsage();
    u[id] = (u[id] ?? 0) + 1;
    localStorage.setItem(USAGE_KEY, JSON.stringify(u));
  } catch { /* 保存できなくても記録はできる */ }
}
