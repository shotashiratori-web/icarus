import type { FieldLogEntry } from '../types/zukan';

// 近い場所同士が連続するよう、貪欲法（毎回いちばん近い未訪問点へ進む）で並び替える。
// 正確な最短経路（巡回セールスマン問題）は求めず、実用上十分な「近場をまとめて回れる順」を目的とする。
// 開始点は最も北西（緯度が高く経度が低い）の点に固定し、実行のたびに順序がぶれないようにする。
export function sortByGpsProximity(entries: FieldLogEntry[]): FieldLogEntry[] {
  if (entries.length <= 1) return [...entries];

  const remaining = [...entries];
  remaining.sort((a, b) => (b.lat - a.lat) || (a.lng - b.lng));
  const path: FieldLogEntry[] = [remaining.shift()!];

  while (remaining.length > 0) {
    const last = path[path.length - 1];
    let nearestIndex = 0;
    let nearestDistSq = Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const dLat = remaining[i].lat - last.lat;
      const dLng = remaining[i].lng - last.lng;
      const distSq = dLat * dLat + dLng * dLng; // 比較用途のみのため平方根は取らない
      if (distSq < nearestDistSq) {
        nearestDistSq = distSq;
        nearestIndex = i;
      }
    }
    path.push(remaining.splice(nearestIndex, 1)[0]);
  }

  return path;
}
