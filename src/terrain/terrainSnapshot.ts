import { areasAt, type AreaEntry } from './areaSelection';
import { cellIndex, cellValues, latLngToGrid } from './engine';
import type { ForestData } from './forest';
import { aspectDeg, directionOf, DIRECTION_LABEL, LANDFORMS, twiValue, type HydroGrid } from './hydro';
import type { TerrainGrid, TerrainManifest } from './types';

// 記録時の地形の値（Spot の terrain_json）。設計: icarus_spot_terrain_snapshot_area_design.md
// 原則: 「今画面で何を見ているか」と「記録した地点がどこにあるか」を分ける。表示中の山域を地点の判定に使わない。
// status:
//   ok        … 地点を含む山域の地形パッケージから計算した
//   not_saved … 地点を含む山域は分かったが、端末に地形データが無い（後で「地形情報を再取得」で埋める）
//   outside   … どの山域にも入らない
// 2026-10-06 より前の記録は status が無く、取れなかった時は { terrainVersion, outside: true }（表示中の山域の版が入っている）

export interface DecodedArea {
  manifest: TerrainManifest;
  grid: TerrainGrid;
  hydro: HydroGrid | null;
  forest: ForestData | null;
}

export type TerrainSnapshot = Record<string, unknown>;

// 1 つの山域の値。格子の外なら null
export function snapshotFrom(d: DecodedArea, lat: number, lng: number): TerrainSnapshot | null {
  const { manifest, grid } = d;
  const { x, y } = latLngToGrid(manifest, lat, lng);
  const i = cellIndex(grid, x, y);
  if (i === null) return null;
  const v = cellValues(manifest, grid, i);
  const snap: TerrainSnapshot = {
    status: 'ok', areaId: manifest.areaId, terrainVersion: manifest.version,
    slopeDeg: Math.round(v.slopeDeg), sun: Math.round(v.sun * 100) / 100,
    ridgeM: v.ridgeM === null ? null : Math.round(v.ridgeM), roadM: v.roadM === null ? null : Math.round(v.roadM),
  };
  const h = d.hydro;
  if (h) {
    const deg = aspectDeg(h.aspect[i]);
    snap.aspectDeg = deg === null ? null : Math.round(deg);
    snap.aspect = deg === null ? '平坦' : DIRECTION_LABEL[directionOf(deg)];
    snap.landform = LANDFORMS.find((l) => l.id === h.landform[i])?.label ?? null;
    snap.streamM = h.streamDist[i] === 255 ? null : Math.round(h.streamDist[i] * manifest.grid.pxM);
    snap.stream = h.streamDist[i] === 255 ? '沢の目安から約1.2km以上' : `沢の目安から約${Math.round((h.streamDist[i] * manifest.grid.pxM) / 10) * 10}m`;
    snap.twi = Math.round(twiValue(manifest, h.twiLevel[i]) * 10) / 10;
  }
  const f = d.forest;
  if (f) {
    const st = f.stand[i] ? f.stands[f.stand[i] - 1] : null;
    const vg = f.veg[i] ? f.vegs[f.veg[i] - 1] : null;
    snap.forestStand = st ? { owner: st.owner, year: st.year, species: st.species.map(([n]) => n), mizunaraRank: st.mizunaraRank } : null;
    snap.vegetation = vg ? { name: vg.name, year: vg.year } : null;
  }
  return snap;
}

export interface ResolveDeps {
  areaList: AreaEntry[]; // 公開中・保存済みの山域（表示中かどうかは関係ない）
  current: DecodedArea | null; // 表示中の山域（読み込み済みならそのまま使う。判定には使わない）
  loadSaved: (areaId: string) => Promise<DecodedArea | null>; // 端末に保存済みの山域を読む（ネットからは取らない）
}

// 地点を含む山域を決め、その山域の地形データで計算する
export async function resolveTerrainSnapshot(lat: number, lng: number, deps: ResolveDeps): Promise<TerrainSnapshot> {
  const candidates = areasAt(deps.areaList, lat, lng); // 重なりは保存済み → 北の順
  if (candidates.length === 0) return { status: 'outside', outside: true };
  for (const a of candidates) {
    let d: DecodedArea | null = null;
    if (deps.current && deps.current.manifest.areaId === a.areaId) d = deps.current;
    else if (a.saved) d = await deps.loadSaved(a.areaId).catch(() => null);
    const snap = d ? snapshotFrom(d, lat, lng) : null;
    if (snap) return snap;
  }
  const a = candidates[0];
  return { status: 'not_saved', areaId: a.areaId, areaName: a.name };
}

