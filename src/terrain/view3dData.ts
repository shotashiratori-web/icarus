import type { RoadClass } from './types';
import { ROAD_CASING, ROAD_STYLE, TRAIL_CLASSES, VEHICLE_CLASSES } from './roads';

// 3D に渡すデータの形（icarus_3d_panel_integration_v1_design.md PR1）。3D を開いたまま 2D の条件の変化に追従するため、
// 重ね表示は名前つきの枠（無い時は透明の画像）、点・線は GeoJSON にして差し替える。MapLibre を知らない純粋な関数だけ

// 重ね表示の枠（下から順）。3D を開いた後で中身だけ差し替える
export const LAYER_SLOTS = ['forest', 'candidates', 'hydro', 'target', 'match', 'outline'] as const;
export type LayerSlot = (typeof LAYER_SLOTS)[number];
export interface Layer3D { url: string | null; opacity: number }
export type Layers3D = Record<LayerSlot, Layer3D>;

// 1×1 の透明 PNG（枠に中身が無い時）
export const BLANK_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

export function layerImage(l: Layer3D): { url: string; visible: boolean; opacity: number } {
  return { url: l.url ?? BLANK_PNG, visible: !!l.url, opacity: l.opacity };
}

export interface Point3D { lat: number; lng: number; label: string; color?: string; radius?: number }
export interface SpotFeature { lat: number; lng: number; label: string; color: string; mizunara: boolean }

type Feature = { type: 'Feature'; properties: Record<string, unknown>; geometry: { type: string; coordinates: unknown } };
export interface FC { type: 'FeatureCollection'; features: Feature[] }

// [lat, lng] → GeoJSON の [lng, lat]
export function tracksGeoJSON(tracks: [number, number][][]): FC {
  return { type: 'FeatureCollection', features: tracks.length ? [{ type: 'Feature', properties: {}, geometry: { type: 'MultiLineString', coordinates: tracks.map((t) => t.map(([la, ln]) => [ln, la])) } }] : [] };
}

export function spotsGeoJSON(spots: SpotFeature[]): FC {
  return { type: 'FeatureCollection', features: spots.map((s, i) => ({ type: 'Feature', properties: { idx: i, label: s.label, color: s.color, mizunara: s.mizunara }, geometry: { type: 'Point', coordinates: [s.lng, s.lat] } })) };
}

export const POINT_COLOR = '#2b8a3e';
export function pointsGeoJSON(points: Point3D[]): FC {
  return { type: 'FeatureCollection', features: points.map((p) => ({ type: 'Feature', properties: { label: p.label, color: p.color ?? POINT_COLOR, radius: p.radius ?? 5 }, geometry: { type: 'Point', coordinates: [p.lng, p.lat] } })) };
}

// 前に貼った枠と比べて、画像・表示・濃さのどれかが変わったか（変わった枠だけ差し替える。
// 3D の地形は画像の差し替えでしか描き直されないので、濃さだけ変わった時も差し替える）
export type AppliedLayer = ReturnType<typeof layerImage>;
export function slotChanged(prev: AppliedLayer | undefined, next: AppliedLayer): boolean {
  return !prev || prev.url !== next.url || prev.visible !== next.visible || prev.opacity !== next.opacity;
}

// ---- 道（3D パネル統合 PR2）。2D と同じ道のデータ・同じ見た目（roads.ts の ROAD_STYLE）。2D の「道路・林道」「登山道・徒歩道」に従う ----

// 種類ごとの線（[lat, lng]）→ GeoJSON（properties.c = 種類）。表示しない種類は入れない
export function roadsGeoJSON(groups: Record<RoadClass, [number, number][][]> | null, show: { road: boolean; trail: boolean }): FC {
  if (!groups) return { type: 'FeatureCollection', features: [] };
  const classes = [...(show.road ? VEHICLE_CLASSES : []), ...(show.trail ? TRAIL_CLASSES : [])];
  return {
    type: 'FeatureCollection',
    features: classes.filter((c) => groups[c]?.length).map((c) => ({
      type: 'Feature', properties: { c }, geometry: { type: 'MultiLineString', coordinates: groups[c].map((l) => l.map(([la, ln]) => [ln, la])) },
    })),
  };
}

// MapLibre の線の見た目（破線は線の太さを単位にする。Leaflet の dashArray は px）
export interface RoadPaint3D { c: RoadClass; color: string; width: number; casingWidth: number; dash: number[] | null; round: boolean }
export const ROAD_PAINT_3D: RoadPaint3D[] = (['road', 'narrow', 'forest', 'trail'] as RoadClass[]).map((c) => {
  const st = ROAD_STYLE[c];
  const dash = st.dashArray ? st.dashArray.split(' ').map((v) => Number(v) / st.weight) : null;
  return { c, color: st.color, width: st.weight, casingWidth: st.weight + ROAD_CASING.extra, dash, round: st.lineCap === 'round' };
});

// ---- 古い林分へ飛ぶ（PR3）。林分の格子の範囲（両端を含む）→ 経緯度の範囲。押すたびに key を変える ----
export interface Focus3D { key: number; south: number; west: number; north: number; east: number }
export function focusFromBox(toLatLng: (x: number, y: number) => { lat: number; lng: number }, box: { x0: number; y0: number; x1: number; y1: number }, key: number): Focus3D {
  const nw = toLatLng(box.x0, box.y0), se = toLatLng(box.x1 + 1, box.y1 + 1);
  return { key, south: se.lat, west: nw.lng, north: nw.lat, east: se.lng };
}
