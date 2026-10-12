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
