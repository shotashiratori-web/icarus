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


// ---- 記録された地形の状態と、再取得の比較（PR 3） ----

export type TerrainState = 'ok' | 'not_saved' | 'outside' | 'failed_legacy' | 'none';

// failed_legacy = 2026-10-06 より前の形で取れなかった記録（{ terrainVersion: 表示中の版, outside: true }）
export function terrainState(t: TerrainSnapshot | null | undefined): TerrainState {
  if (!t) return 'none';
  if (t.status === 'not_saved') return 'not_saved';
  if (t.status === 'outside') return 'outside';
  if (t.status === undefined && t.outside === true) return 'failed_legacy';
  return 'ok';
}

// 1 行の要約（方位・斜面の位置・傾斜・沢の目安）
export function terrainSummary(t: TerrainSnapshot): string {
  return [t.aspect && `方位 ${String(t.aspect)}`, t.landform, t.slopeDeg !== undefined && t.slopeDeg !== null && `傾斜 ${String(t.slopeDeg)}°`, t.stream]
    .filter(Boolean).map(String).join('・');
}

const stable = (v: unknown): unknown => {
  if (Array.isArray(v)) return v.map(stable);
  if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v as object).sort().map((k) => [k, stable((v as Record<string, unknown>)[k])]));
  return v;
};
export function sameTerrain(a: TerrainSnapshot | null | undefined, b: TerrainSnapshot | null | undefined): boolean {
  return JSON.stringify(stable(a ?? null)) === JSON.stringify(stable(b ?? null));
}

// 新旧を並べて見せる行（値が無い項目は「—」）
export function terrainRows(t: TerrainSnapshot | null | undefined, areaName: (areaId: string) => string): { label: string; value: string }[] {
  const st = terrainState(t);
  const dash = '—';
  if (!t || st !== 'ok') {
    const why = st === 'not_saved' ? `取得できていません（${String(t?.areaName ?? areaName(String(t?.areaId)))}を端末に保存していなかった）`
      : st === 'outside' ? 'どの山域にも入らない地点'
      : st === 'failed_legacy' ? '取得できていません（記録した時に別の山域を表示していた可能性）'
      : 'なし';
    return [{ label: '地形', value: why }];
  }
  const fs = t.forestStand as { species?: string[]; mizunaraRank?: number; owner?: string; year?: number } | null | undefined;
  const vg = t.vegetation as { name?: string; year?: number } | null | undefined;
  const num = (v: unknown, unit: string) => (v === null || v === undefined ? dash : `${String(v)}${unit}`);
  return [
    { label: '山域・版', value: `${t.areaId ? areaName(String(t.areaId)) : dash} ${String(t.terrainVersion ?? dash)}` },
    { label: '傾斜', value: num(t.slopeDeg, '°') },
    { label: '方位', value: t.aspect ? String(t.aspect) : dash },
    { label: '斜面の位置', value: t.landform ? String(t.landform) : dash },
    { label: '沢の目安', value: t.stream ? String(t.stream) : dash },
    { label: '湿潤度 TWI', value: num(t.twi, '') },
    { label: '日射', value: num(t.sun, '') },
    { label: '尾根まで', value: num(t.ridgeM, 'm') },
    { label: '林分', value: fs ? `${(fs.species ?? []).join('・') || '樹種の記録なし'}${fs.mizunaraRank ? `（ミズナラ ${fs.mizunaraRank} 位）` : ''}` : dash },
    { label: '植生', value: vg?.name ?? dash },
  ];
}

// 訂正の理由（履歴に残る）
export function refetchReason(t: TerrainSnapshot, areaName: (areaId: string) => string): string {
  const area = t.areaId ? `${areaName(String(t.areaId))} ` : '';
  return `地形情報を再取得（${area}${String(t.terrainVersion ?? '')}）`;
}
