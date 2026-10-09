import type { AreaPackage } from './areaStore';

// 地図の河川（River Basemap v1）。地形パッケージの rivers.json（国土地理院 ベクトルタイル 1/25,000）。
// 2D では常に表示する基礎の地物（道・等高線と同じ階層）。DEM から計算した「沢の目安」とは別物で、混ぜない
// 設計: icarus_terrain_rivers_package_design.md
export type LatLng = [number, number];
export interface RiverLines {
  c: LatLng[][]; // 河川中心線
  e: LatLng[][]; // 水涯線（幅のある川の岸）
}

export const RIVER_COLOR = '#0d47a1';
export const RIVER_EDGE_COLOR = '#64b5f6';

// 古い版（2026-10-08 より前）には無い → null（河川なしで今までどおり動く）
export async function decodeRivers(pkg: AreaPackage): Promise<RiverLines | null> {
  const f = pkg.files['rivers.json'];
  if (!f) return null;
  const j = JSON.parse(await f.text()) as Partial<RiverLines>;
  if (!Array.isArray(j.c) || !Array.isArray(j.e)) throw new Error('地図の河川のデータの形が違います');
  return { c: j.c, e: j.e };
}

// 点から折れ線までの最短距離（m）。短い範囲なので経緯度を局所的に平面とみなす
export function nearestLineDistanceM(p: LatLng, lines: LatLng[][]): number | null {
  const kx = Math.cos((p[0] * Math.PI) / 180) * 111320, ky = 110540;
  let best: number | null = null;
  for (const ln of lines) {
    for (let i = 1; i < ln.length; i++) {
      const ax = (ln[i - 1][1] - p[1]) * kx, ay = (ln[i - 1][0] - p[0]) * ky;
      const bx = (ln[i][1] - p[1]) * kx, by = (ln[i][0] - p[0]) * ky;
      const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
      const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / l2));
      const d = Math.hypot(ax + t * dx, ay + t * dy);
      if (best === null || d < best) best = d;
    }
  }
  return best;
}

export function mapRiverDistanceM(r: RiverLines, lat: number, lng: number): number | null {
  const d = nearestLineDistanceM([lat, lng], [...r.c, ...r.e]);
  return d === null ? null : Math.round(d);
}

export function riverDistanceText(m: number): string {
  const r = Math.round(m / 10) * 10; // 10m 単位にしてから（995m を「約1000m」と出さない）
  return r >= 1000 ? `約${(r / 1000).toFixed(1)}km` : `約${r}m`;
}
