import type { RoadClass, RoadLine } from './types';

// 道の表示・最寄りの道。車で入れる道 = 一般道・幅 3m 未満・林道／作業道、徒歩道 = 登山道・徒歩道

export const VEHICLE_CLASSES: RoadClass[] = ['road', 'narrow', 'forest'];
export const TRAIL_CLASSES: RoadClass[] = ['trail'];

export const ROAD_CLASS_LABEL: Record<RoadClass, string> = {
  road: '一般道',
  narrow: '幅3m未満の道',
  forest: '林道・作業道',
  trail: '登山道・徒歩道',
};

// 道の見た目。森林・陰影・等高線（茶）のどれを重ねても形が残るよう、全種類に白い縁取りを付け、等高線にない色にする
// （一般道 = 濃灰、林道・作業道 = オレンジ実線、幅3m未満 = オレンジ破線、登山道 = 黒点線）。縁取りは破線にせず、道の形を保つ
export const ROAD_CASING = { color: '#fff', extra: 3, opacity: 0.9 } as const;
export const ROAD_ORANGE = '#f08c00';
export const ROAD_STYLE: Record<RoadClass, { color: string; weight: number; dashArray?: string; lineCap?: 'round' }> = {
  road: { color: '#343a40', weight: 2.2 },
  narrow: { color: ROAD_ORANGE, weight: 2, dashArray: '6 4' },
  forest: { color: ROAD_ORANGE, weight: 3 },
  trail: { color: '#212529', weight: 2, dashArray: '2 5', lineCap: 'round' },
};

// Leaflet の Polyline に渡す形（縁取り・色の線）
export function roadCasing(c: RoadClass) {
  return { color: ROAD_CASING.color, weight: ROAD_STYLE[c].weight + ROAD_CASING.extra, opacity: ROAD_CASING.opacity, lineCap: 'round' as const, interactive: false };
}
export function roadLine(c: RoadClass) {
  const st = ROAD_STYLE[c];
  return { color: st.color, weight: st.weight, opacity: 1, ...(st.dashArray ? { dashArray: st.dashArray } : {}), ...(st.lineCap ? { lineCap: st.lineCap } : {}), interactive: false };
}

// 種類ごとに線をまとめる（Leaflet には種類ごとに 1 本の MultiPolyline として渡す。3 万本を個別に持たない）
export function groupByClass(lines: RoadLine[]): Record<RoadClass, [number, number][][]> {
  const g: Record<RoadClass, [number, number][][]> = { road: [], narrow: [], forest: [], trail: [] };
  for (const l of lines) g[l.c]?.push(l.p);
  return g;
}

export interface IndexedRoads {
  lines: RoadLine[];
  bbox: Float64Array; // [south, north, west, east] × 本数
}

export function indexRoads(lines: RoadLine[]): IndexedRoads {
  const bbox = new Float64Array(lines.length * 4);
  lines.forEach((l, i) => {
    let s = 90, n = -90, w = 180, e = -180;
    for (const [la, ln] of l.p) {
      if (la < s) s = la; if (la > n) n = la; if (ln < w) w = ln; if (ln > e) e = ln;
    }
    bbox.set([s, n, w, e], i * 4);
  });
  return { lines, bbox };
}

export interface NearestRoad {
  distanceM: number;
  line: RoadLine;
}

// 点から線分までの距離（局所的な平面近似。1.5km 程度なら十分）
export function nearestRoad(idx: IndexedRoads, lat: number, lng: number, classes: RoadClass[], maxM = 1500): NearestRoad | null {
  const ky = 111320;
  const kx = 111320 * Math.cos((lat * Math.PI) / 180);
  const dLat = maxM / ky;
  const dLng = maxM / kx;
  let best: NearestRoad | null = null;
  for (let i = 0; i < idx.lines.length; i++) {
    const l = idx.lines[i];
    if (!classes.includes(l.c)) continue;
    const b = i * 4;
    if (idx.bbox[b] > lat + dLat || idx.bbox[b + 1] < lat - dLat || idx.bbox[b + 2] > lng + dLng || idx.bbox[b + 3] < lng - dLng) continue;
    for (let k = 1; k < l.p.length; k++) {
      const ax = (l.p[k - 1][1] - lng) * kx, ay = (l.p[k - 1][0] - lat) * ky;
      const bx = (l.p[k][1] - lng) * kx, by = (l.p[k][0] - lat) * ky;
      const dx = bx - ax, dy = by - ay;
      const len2 = dx * dx + dy * dy;
      const t = len2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2)) : 0;
      const d = Math.hypot(ax + t * dx, ay + t * dy);
      if (d <= maxM && (!best || d < best.distanceM)) best = { distanceM: d, line: l };
    }
  }
  return best;
}

export function describeRoad(r: NearestRoad | null): string {
  if (!r) return '1.5km 以内になし';
  const name = r.line.n || ROAD_CLASS_LABEL[r.line.c];
  return `約${Math.round(r.distanceM / 10) * 10}m（${name}${r.line.f ? '・' + r.line.f : ''}）`;
}
