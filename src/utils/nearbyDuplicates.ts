import type { FieldLogEntry } from '../types/zukan';

// 完全一致（同一秒＋同一GPS）の重複検知（zukanFieldStore.computeDuplicateCandidateIds）とは別に、
// 「同じ被写体を連続撮影した」ような近似重複を見つけるための緩い判定。
// 一括写真送信でバースト撮影した写真が個別に未整理のまま溜まっているケースが多いため。
const TIME_WINDOW_MS = 10 * 60 * 1000; // 10分以内
const DISTANCE_DEG_THRESHOLD = 0.0005; // 概ね50m程度（緯度1度≒111km換算の目安）

export function findNearbyEntries(entry: FieldLogEntry, allEntries: FieldLogEntry[]): FieldLogEntry[] {
  if (!entry.takenAt) return [];
  const entryTime = new Date(entry.takenAt).getTime();
  if (isNaN(entryTime)) return [];

  return allEntries.filter((other) => {
    if (other.id === entry.id) return false;
    if (!other.takenAt) return false;
    const otherTime = new Date(other.takenAt).getTime();
    if (isNaN(otherTime)) return false;
    if (Math.abs(otherTime - entryTime) > TIME_WINDOW_MS) return false;
    const dLat = other.lat - entry.lat;
    const dLng = other.lng - entry.lng;
    return Math.sqrt(dLat * dLat + dLng * dLng) <= DISTANCE_DEG_THRESHOLD;
  });
}
