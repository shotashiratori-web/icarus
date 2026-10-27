import { useEffect, useRef, useState } from 'react';
import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import { gsiToTerrarium } from '../../terrain/gsiDem';
import { markReadyOnLoad, whenReady } from '../../terrain/mapReady';
import type { Inspector } from '../../terrain/forestWater';
import { GSI_VECTOR_TILES, mapRiverText, nearestMapRiver, RIVER_CENTER_CODES, RIVER_EDGE_CODES } from '../../terrain/gsiRivers';
import type { TerrainBounds } from '../../terrain/types';
import { LAYER_SLOTS, layerImage, pointsGeoJSON, ROAD_PAINT_3D, sameGround, slotChanged, spotsGeoJSON, tracksGeoJSON, type AppliedLayer, type RouteMark3D, type FC, type Layers3D, type Point3D } from '../../terrain/view3dData';
import { ROAD_CLASS_LABEL } from '../../terrain/roads';
import { CANDIDATE_LABEL_MIN_ZOOM, shortPinLabel, type CandidatePin } from '../../exploration/candidatePins';
import { ROUTE_COLOR } from './RoutePlanPanel';
import { isStop, type RoutePoint } from '../../exploration/routePlan';
import styles from './ExplorationMap.module.css';

// 3D（PC だけ・見るだけ）。設計: icarus_3d_terrain_view_technical_audit.md §8（3D-1）
// - 標高は国土地理院 標高タイル dem_png を直接（電波が必要）。地形パッケージ・R2 は変えない
// - 2D で今表示している層の画像を、同じ範囲の 4 隅に貼る（同じ関数で作った canvas の画像）
// - 探索履歴 GPX・環境スポット（木など）・Field Log の点。記録・訂正・案内は 2D から
// - 3D-2 Forest & Water Context: 木を押すと状態・観察・森・地形・水（読み取り専用）。水は 地図の河川／沢の目安（DEM）／湿りやすさ（TWI）を分けて重ねる
//   設計: icarus_3d2_forest_water_context_audit.md
// - 予測地点（検証候補）: 2D と同じ紫の「？」＋名前を地形の上に出す。押すと名前・説明・座標のコピー（案内は 2D から）
// - 3D パネル統合 PR1（icarus_3d_panel_integration_v1_design.md）: 右のパネルは 2D と同じものを残し、3D は開いたまま
//   2D の条件の変化に追従する（重ね表示は名前つきの枠の画像を差し替え、点・線は GeoJSON を差し替え）
// このファイルと MapLibre は asset-manifest から外す（iPhone に保存させない。build/assetManifest.ts）

export interface Spot3D { lat: number; lng: number; label: string; color: string; mizunara: boolean; inspector: Inspector }
export type { Point3D };
export interface Terrain3DProps {
  bounds: TerrainBounds;
  layers: Layers3D; // 2D の層の画像（object URL）。名前つきの枠、下から LAYER_SLOTS の順
  twiUrl: string | null; // 湿りやすさ（TWI 上位 33%・10%）
  streamsUrl: string | null; // 沢の目安（DEM。3D では水色）
  tracks: [number, number][][]; // [lat, lng]
  roads: FC; // 道（PR2）。2D と同じデータ・見た目。2D の「道路・林道」「登山道・徒歩道」で絞った後のもの
  spots: Spot3D[];
  points: Point3D[];
  candidates: CandidatePin[]; // 予測地点（2D の一覧で表示にしている組だけ）
  routeLines: [number, number][][]; // 探索計画の線（2D で表示にしている計画だけ。[lat, lng]）
  routeMarks: RouteMark3D[]; // 探索計画の S・G・立ち寄り地点・既存候補（経由点は出さない）
  initial: { lat: number; lng: number; zoom: number };
  // PR3: 「林齢の古い林分から見る」を押した林分へ飛ぶ（key が変わるたびに 1 回）。範囲は経緯度
  focus: { key: number; south: number; west: number; north: number; east: number } | null;
  // PR3: 地面を押した所の地点情報を 2D と同じ場所に出す（標高は 3D の地形から。強調を戻した値）
  onPick: (lat: number, lng: number, elevM: number | null) => void;
  // 探索計画を作っている間（2D と同じ計画を共有）。地表を押すと経由点・点はドラッグで直す・押すと帯の一覧で選ぶ
  edit: { points: RoutePoint[]; sel: number | null } | null;
  onEditAdd: (lat: number, lng: number) => void;
  onEditMove: (i: number, lat: number, lng: number) => void;
  onEditSelect: (i: number | null) => void;
  onEditCandidate: (p: CandidatePin & { setTitle?: string }) => void; // 予測地点の「？」→ 既存候補（組の名前は 2D から渡る）
  areaName: string;
  onClose: () => void;
}

let protocolReady = false;
function ensureSetup() {
  if (protocolReady) return;
  protocolReady = true;
  maplibregl.setWorkerUrl(workerUrl);
  maplibregl.addProtocol('gsidem', async (params) => {
    const res = await fetch(params.url.replace('gsidem://', 'https://'));
    const size = 256;
    const c = new OffscreenCanvas(size, size);
    const g = c.getContext('2d', { willReadFrequently: true })!;
    if (!res.ok) { // 404 = 海。0m の平らなタイル
      g.fillStyle = 'rgb(128,0,0)';
      g.fillRect(0, 0, size, size);
    } else {
      g.drawImage(await createImageBitmap(await res.blob()), 0, 0);
      const img = g.getImageData(0, 0, size, size);
      gsiToTerrarium(img.data);
      g.putImageData(img, 0, 0);
    }
    return { data: await (await c.convertToBlob({ type: 'image/png' })).arrayBuffer() };
  });
}

const GSI = (id: string, ext: string) => `https://cyberjapandata.gsi.go.jp/xyz/${id}/{z}/{x}/{y}.${ext}`;

// ポップアップの中身（テキストだけで組み立てる。HTML 文字列は使わない）
function el(tag: string, cls: string | null, text?: string): HTMLElement {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}
function inspectorDom(ins: Inspector): { root: HTMLElement; elev: HTMLElement; river: HTMLElement } {
  const root = el('div', styles.inspector);
  root.append(el('strong', styles.inspTitle, ins.title));
  const row = (parent: HTMLElement, label: string, value: string | null, note?: string | null) => {
    const r = el('div', styles.inspRow);
    r.append(el('span', styles.inspLabel, label), el('span', value === null ? styles.inspMissing : null, value ?? note ?? '—'));
    parent.append(r);
  };
  const section = (name: string) => { const sec = el('div', styles.inspSection); sec.append(el('div', styles.inspHead, name)); root.append(sec); return sec; };
  if (ins.pending) {
    root.append(el('p', styles.inspMissing, 'この端末で未送信（送信後に詳しく見られます）'));
  }
  if (ins.tree) {
    row(root, '胸高直径', ins.tree.dbh);
    row(root, '腐朽度', ins.tree.decay ?? (ins.tree.decayNote ? ins.tree.decayNote : null));
  }
  if (!ins.pending) root.append(el('div', styles.inspSub, `${ins.firstSeen ? `初回確認 ${ins.firstSeen}・` : ''}観察 ${ins.obsCount}回`));
  if (ins.observations.length) {
    const sec = section('観察');
    for (const o of ins.observations) {
      const r = el('div', styles.inspRow);
      r.append(el('span', styles.inspLabel, o.target), el('span', o.mark === '✓' ? styles.inspFound : styles.inspNotFound, `${o.mark} ${o.result}`),
        el('span', null, ` ${o.date}${o.stage ? ` ${o.stage}` : ''}${o.more ? `（ほか${o.more}回）` : ''}`));
      sec.append(r);
    }
  }
  if (ins.forest && (ins.forest.ranks || ins.forest.veg)) {
    const sec = section('森');
    if (ins.forest.ranks) sec.append(el('div', null, ins.forest.ranks));
    if (ins.forest.veg) sec.append(el('div', null, ins.forest.veg));
  }
  const sec = section('地形・水');
  const elev = el('div', null, '標高 …');
  sec.append(elev);
  if (ins.terrain) sec.append(el('div', null, ins.terrain));
  if (ins.water?.twi) sec.append(el('div', null, ins.water.twi));
  if (ins.water?.stream) sec.append(el('div', null, ins.water.stream));
  const river = el('div', null, '地図の河川 …');
  sec.append(river);
  if (ins.terrainNote) sec.append(el('div', styles.inspMissing, `記録時の地形: ${ins.terrainNote}`));
  root.append(el('div', styles.inspFoot, '記録・観察の追加・訂正は 2D から'));
  return { root, elev, river };
}

// 予測地点の目印（2D と同じ紫の「？」＋名前）
function candidateNode(p: CandidatePin): HTMLElement {
  const node = el('div', styles.candidate3d);
  const pin = el('span', styles.candidatePin, '？');
  pin.setAttribute('aria-label', '予測地点（未確認）');
  node.append(pin, el('span', `${styles.candidateLabel} cand3dLabel`, shortPinLabel(p.name)));
  return node;
}

// 予測地点のポップアップ（テキストだけで組み立てる）
function candidateDom(p: CandidatePin, onAdd?: () => void): HTMLElement {
  const root = el('div', styles.inspector);
  root.append(el('strong', styles.inspTitle, `？ ${p.name}`), el('div', styles.inspSub, '予測・未確認'));
  if (p.desc) root.append(el('div', null, p.desc));
  if (onAdd) {
    const add = el('button', `${styles.btn} ${styles.primary}`, '計画に入れる') as HTMLButtonElement;
    add.onclick = onAdd;
    root.append(add);
  }
  const t = `${p.lat.toFixed(6)}, ${p.lng.toFixed(6)}`;
  const copy = el('button', styles.btn, '座標をコピー') as HTMLButtonElement;
  copy.onclick = () => { navigator.clipboard?.writeText(t).then(() => { copy.textContent = 'コピーしました'; }, () => undefined); };
  const foot = el('div', styles.inspFoot, 'ここへ行く・記録は 2D から ');
  foot.append(copy);
  root.append(foot);
  return root;
}

// 探索計画の目印（2D と同じ黄緑の丸・始点は白。S/G は丸の中に字）＋名前
function routeMarkNode(m: RouteMark3D): HTMLElement {
  const node = el('div', styles.route3d);
  const dot = el('span', styles.route3dDot, m.role === 'start' ? 'S' : m.role === 'goal' ? 'G' : '');
  dot.style.background = m.role === 'start' ? '#fff' : ROUTE_COLOR;
  const name = m.label.replace(/^[SG] ?/, '');
  node.append(dot);
  if (name) node.append(el('span', styles.route3dLabel, name));
  return node;
}

function routeMarkDom(m: RouteMark3D): HTMLElement {
  const root = el('div', styles.inspector);
  root.append(el('strong', styles.inspTitle, m.plan), el('div', styles.inspSub, m.label));
  if (m.role === 'stop' || m.role === 'candidate') {
    if (m.memo) root.append(el('div', null, m.memo));
    root.append(el('div', null, `滞在 ${m.stayMin ?? 0}分${m.setTitle ? `・${m.setTitle}` : ''}`));
  }
  root.append(el('div', styles.inspFoot, '作る・直す・ここへ行くは 2D から'));
  return root;
}

// 押した所（動かした所）が、今の視点で本当に見えている地表か（view3dData.sameGround の説明）
function isVisibleGround(map: maplibregl.Map, ll: maplibregl.LngLat): boolean {
  if (map.queryTerrainElevation(ll) === null) return false;
  const back = map.unproject(map.project(ll));
  return !!back && sameGround(ll, back, map.getZoom());
}

// 作っている計画の点（2D と同じ: 経由点は小さく、S・G・立ち寄り地点は大きく名前つき。選んでいる点は橙の縁）
function editPointNode(p: RoutePoint, i: number, n: number, on: boolean): HTMLElement {
  const stop = isStop(p), end = i === 0 || i === n - 1, size = stop || end ? 16 : 11;
  const node = el('div', styles.route3d);
  const dot = el('span', styles.routeDot);
  dot.style.width = `${size}px`; dot.style.height = `${size}px`; dot.style.cursor = 'grab';
  if (i === 0) dot.style.background = '#fff';
  if (on) dot.style.boxShadow = '0 0 0 3px #ff6f00';
  node.append(dot);
  const label = [i === 0 ? 'S' : i === n - 1 ? 'G' : '', stop ? p.name ?? '' : ''].filter(Boolean).join(' ');
  if (label) node.append(el('span', styles.route3dLabel, label));
  return node;
}

// 凡例の開閉はこの端末に覚えておく（初めは閉じる。読めない・書けない時は閉じる）
const LEGEND_KEY = 'icarus.3d.legendOpen';
function loadLegendOpen(): boolean {
  try { return localStorage.getItem(LEGEND_KEY) === '1'; } catch { return false; }
}

export default function Terrain3DView({ bounds, layers, twiUrl, streamsUrl, tracks, roads, spots, points, candidates, routeLines, routeMarks, initial, focus, onPick, edit, onEditAdd, onEditMove, onEditSelect, onEditCandidate, areaName, onClose }: Terrain3DProps) {
  const el = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const [base, setBase] = useState<'shade' | 'photo'>('shade');
  const [ex, setEx] = useState(1.5);
  const [error, setError] = useState<string | null>(null);
  const [showStreams, setShowStreams] = useState(true);
  const [showTwi, setShowTwi] = useState(true);
  const [legendOpen, setLegendOpen] = useState(loadLegendOpen);
  const toggleLegend = () => {
    const next = !legendOpen;
    setLegendOpen(next);
    try { localStorage.setItem(LEGEND_KEY, next ? '1' : '0'); } catch { /* 覚えられなくても開閉はできる */ }
  };
  const exRef = useRef(1.5);
  exRef.current = ex;
  const spotsRef = useRef(spots);
  spotsRef.current = spots;
  const onPickRef = useRef(onPick);
  onPickRef.current = onPick;
  const editRef = useRef(edit);
  editRef.current = edit;
  const editCb = useRef({ onEditAdd, onEditMove, onEditSelect, onEditCandidate });
  editCb.current = { onEditAdd, onEditMove, onEditSelect, onEditCandidate };
  const [hint, setHint] = useState<string | null>(null);
  const editing = edit !== null;
  // 3D に貼った重ね表示の枠ごとの、今の画像・表示・濃さ（変わった枠だけ差し替える）
  const appliedRef = useRef<Record<string, AppliedLayer>>({});

  useEffect(() => {
    if (!el.current) return;
    ensureSetup();
    const corners: [[number, number], [number, number], [number, number], [number, number]] = [
      [bounds.west, bounds.north], [bounds.east, bounds.north], [bounds.east, bounds.south], [bounds.west, bounds.south],
    ];
    const map = new maplibregl.Map({
      container: el.current,
      center: [initial.lng, initial.lat],
      zoom: Math.min(initial.zoom, 16),
      pitch: 60,
      maxPitch: 85,
      attributionControl: { compact: true },
      style: {
        version: 8,
        sources: {
          dem: { type: 'raster-dem', tiles: ['gsidem://cyberjapandata.gsi.go.jp/xyz/dem_png/{z}/{x}/{y}.png'], tileSize: 256, maxzoom: 14, encoding: 'terrarium', attribution: '国土地理院（標高タイル）' },
          pale: { type: 'raster', tiles: [GSI('pale', 'png')], tileSize: 256, maxzoom: 18, attribution: '国土地理院' },
          shade: { type: 'raster', tiles: [GSI('hillshademap', 'png')], tileSize: 256, maxzoom: 16 },
          photo: { type: 'raster', tiles: [GSI('seamlessphoto', 'jpg')], tileSize: 256, maxzoom: 18 },
          ...Object.fromEntries(LAYER_SLOTS.map((k) => [`ov_${k}`, { type: 'image' as const, url: layerImage(layers[k]).url, coordinates: corners }])),
          ...(twiUrl ? { twi: { type: 'image' as const, url: twiUrl, coordinates: corners } } : {}),
          ...(streamsUrl ? { demStreams: { type: 'image' as const, url: streamsUrl, coordinates: corners } } : {}),
          gsivec: { type: 'vector', tiles: [GSI_VECTOR_TILES], minzoom: 4, maxzoom: 16, attribution: '国土地理院（ベクトルタイル）' },
          tracks: { type: 'geojson', data: tracksGeoJSON(tracks) as never },
          roads: { type: 'geojson', data: roads as never },
          spots: { type: 'geojson', data: spotsGeoJSON(spots) as never },
          points: { type: 'geojson', data: pointsGeoJSON(points) as never },
          routes: { type: 'geojson', data: tracksGeoJSON(routeLines) as never },
          editRoute: { type: 'geojson', data: tracksGeoJSON([]) as never },
        },
        layers: [
          { id: 'pale', type: 'raster', source: 'pale' },
          { id: 'shade', type: 'raster', source: 'shade', paint: { 'raster-opacity': 0.55 } },
          { id: 'photo', type: 'raster', source: 'photo', layout: { visibility: 'none' } },
          ...(twiUrl ? [{ id: 'twi', type: 'raster' as const, source: 'twi', paint: { 'raster-opacity': 1, 'raster-fade-duration': 0 } }] : []),
          ...LAYER_SLOTS.map((k) => {
            const li = layerImage(layers[k]);
            // 濃さの変化は途中を作らない（地形に貼る画像のキャッシュが、変化の途中の濃さで固まらないように）
            return { id: `ov_${k}`, type: 'raster' as const, source: `ov_${k}`, layout: { visibility: li.visible ? 'visible' as const : 'none' as const }, paint: { 'raster-opacity': 0.85 * li.opacity, 'raster-opacity-transition': { duration: 0, delay: 0 }, 'raster-fade-duration': 0 } };
          }),
          ...(streamsUrl ? [{ id: 'demStreams', type: 'raster' as const, source: 'demStreams', paint: { 'raster-opacity': 1, 'raster-fade-duration': 0 } }] : []),
          // 地図の河川（地理院 1/25,000）: 水域・岸は薄い青、中心線は濃紺の実線
          { id: 'river-area', type: 'fill', source: 'gsivec', 'source-layer': 'waterarea', paint: { 'fill-color': '#90caf9', 'fill-opacity': 0.6 } },
          { id: 'river-edge', type: 'line', source: 'gsivec', 'source-layer': 'river', filter: ['in', ['get', 'ftCode'], ['literal', RIVER_EDGE_CODES]], paint: { 'line-color': '#64b5f6', 'line-width': 1.2 } },
          { id: 'river-line', type: 'line', source: 'gsivec', 'source-layer': 'river', filter: ['in', ['get', 'ftCode'], ['literal', RIVER_CENTER_CODES]], paint: { 'line-color': '#0d47a1', 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 1.2, 15, 2.8] } },
          // 道（2D と同じ: 白い縁取り＋一般道 濃灰／林道・作業道 オレンジ実線／幅 3m 未満 オレンジ破線／登山道 黒点線）
          ...ROAD_PAINT_3D.map((r) => ({ id: `road-casing-${r.c}`, type: 'line' as const, source: 'roads', filter: ['==', ['get', 'c'], r.c] as never, layout: { 'line-cap': 'round' as const, 'line-join': 'round' as const }, paint: { 'line-color': '#ffffff', 'line-width': r.casingWidth, 'line-opacity': 0.9 } })),
          ...ROAD_PAINT_3D.map((r) => ({ id: `road-${r.c}`, type: 'line' as const, source: 'roads', filter: ['==', ['get', 'c'], r.c] as never, layout: { 'line-cap': r.round ? 'round' as const : 'butt' as const, 'line-join': 'round' as const }, paint: { 'line-color': r.color, 'line-width': r.width, ...(r.dash ? { 'line-dasharray': r.dash } : {}) } })),
          { id: 'tracks-casing', type: 'line', source: 'tracks', paint: { 'line-color': '#fff', 'line-width': 6, 'line-opacity': 0.85 } },
          { id: 'tracks', type: 'line', source: 'tracks', paint: { 'line-color': '#1a73e8', 'line-width': 3.5 } },
          // 探索計画: 2D と同じ黄緑の点線＋白縁（予定は点線・歩いた跡は青の実線）
          { id: 'routes-casing', type: 'line', source: 'routes', layout: { 'line-join': 'round' }, paint: { 'line-color': '#fff', 'line-width': 8, 'line-opacity': 0.9 } },
          { id: 'routes', type: 'line', source: 'routes', layout: { 'line-join': 'round' }, paint: { 'line-color': ROUTE_COLOR, 'line-width': 4, 'line-dasharray': [2.5, 1.75] } },
          // 作っている計画（2D と同じ見た目）
          { id: 'edit-route-casing', type: 'line', source: 'editRoute', layout: { 'line-join': 'round' }, paint: { 'line-color': '#fff', 'line-width': 8, 'line-opacity': 0.9 } },
          { id: 'edit-route', type: 'line', source: 'editRoute', layout: { 'line-join': 'round' }, paint: { 'line-color': ROUTE_COLOR, 'line-width': 4, 'line-dasharray': [2.5, 1.75] } },
          { id: 'points', type: 'circle', source: 'points', paint: { 'circle-radius': ['get', 'radius'], 'circle-color': ['get', 'color'], 'circle-stroke-color': '#fff', 'circle-stroke-width': 1.5 } },
          { id: 'spots', type: 'circle', source: 'spots', paint: {
            'circle-radius': 8, 'circle-color': ['get', 'color'],
            'circle-stroke-color': ['case', ['get', 'mizunara'], '#f9a825', '#ffffff'], 'circle-stroke-width': ['case', ['get', 'mizunara'], 3, 1.5],
          } },
        ],
        terrain: { source: 'dem', exaggeration: 1.5 },
      },
    });
    mapRef.current = map;
    appliedRef.current = Object.fromEntries(LAYER_SLOTS.map((k) => [k, layerImage(layers[k])]));
    markReadyOnLoad(map);
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right');
    map.addControl(new maplibregl.ScaleControl(), 'bottom-left');
    map.on('error', (e) => { if (!navigator.onLine) setError('3D は電波が必要です（地理院の標高を読みます）'); else console.warn('[3d]', e.error?.message); });
    map.on('click', 'points', (e) => {
      const f = e.features?.[0];
      if (!f) return;
      new maplibregl.Popup({ closeButton: false }).setLngLat(e.lngLat).setText(String(f.properties?.label ?? '')).addTo(map);
    });
    // 地面を押した所の地点情報（木・Field Log の点を押した時は、それぞれの情報を出すので地点情報は出さない）
    map.on('click', (e) => {
      if (editRef.current) {
        // 計画を作っている間: 目印（点・？）を押した時は足さない。押した画素の視線が最初に当たった地表だけに置く
        if ((e.originalEvent.target as HTMLElement | null)?.closest?.('.maplibregl-marker')) return;
        if (!isVisibleGround(map, e.lngLat)) { setHint('地形に隠れた所・空には点を置けません。見えている地表を押してください'); return; }
        setHint(null);
        editCb.current.onEditAdd(e.lngLat.lat, e.lngLat.lng);
        return;
      }
      if (map.queryRenderedFeatures(e.point, { layers: ['spots', 'points'].filter((id) => map.getLayer(id)) }).length) return;
      const h = map.queryTerrainElevation(e.lngLat);
      onPickRef.current(e.lngLat.lat, e.lngLat.lng, h === null || h === undefined ? null : Math.round(h / exRef.current));
    });
    map.on('click', 'spots', (e) => {
      const f = e.features?.[0];
      const s = f ? spotsRef.current[Number(f.properties?.idx)] : undefined;
      if (!s) return;
      const { root, elev, river } = inspectorDom(s.inspector);
      const h = map.queryTerrainElevation([s.lng, s.lat]);
      elev.textContent = h === null || h === undefined ? '標高 —' : `標高 約${Math.round(h / exRef.current)}m（地理院標高）`;
      nearestMapRiver(s.lat, s.lng)
        .then((r) => { river.textContent = mapRiverText(r); })
        .catch(() => { river.textContent = '地図の河川 —（読み込めませんでした）'; });
      new maplibregl.Popup({ closeButton: true, maxWidth: '300px' }).setLngLat([s.lng, s.lat]).setDOMContent(root).addTo(map);
    });
    for (const id of ['spots', 'points']) {
      map.on('mouseenter', id, () => { map.getCanvas().style.cursor = 'pointer'; });
      map.on('mouseleave', id, () => { map.getCanvas().style.cursor = ''; });
    }
    return () => { map.remove(); mapRef.current = null; };
    // 地図は開いた時に 1 回だけ作る。中身は下の effect で差し替える
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // PR3: 古い林分へ飛ぶ。右のパネルに隠れないよう右を広く空け、斜めから見る
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !focus) return;
    whenReady(map, () => {
      map.fitBounds([[focus.west, focus.south], [focus.east, focus.north]], { padding: { top: 200, bottom: 80, left: 60, right: 380 }, maxZoom: 15, pitch: 60, bearing: map.getBearing(), duration: 1200 });
    });
  }, [focus]);

  // 2D の条件が変わったら、重ね表示の画像・点・線を差し替える（開き直さない）。
  // 3D の地形は重ねる画像を地形のタイルごとの絵にして持っておき、画像（ソース）が変わった時・表示する層が変わった時だけ描き直す。
  // 濃さ（paint）だけを変えても描き直されないので、変わった枠は 濃さ → 表示 → 画像の差し替え の順にして描き直させる。変わらない枠は触らない
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const corners: [[number, number], [number, number], [number, number], [number, number]] = [
      [bounds.west, bounds.north], [bounds.east, bounds.north], [bounds.east, bounds.south], [bounds.west, bounds.south],
    ];
    whenReady(map, () => {
      for (const k of LAYER_SLOTS) {
        const li = layerImage(layers[k]);
        const src = map.getSource(`ov_${k}`) as maplibregl.ImageSource | undefined;
        if (!src || !map.getLayer(`ov_${k}`)) continue;
        if (!slotChanged(appliedRef.current[k], li)) continue;
        map.setPaintProperty(`ov_${k}`, 'raster-opacity', 0.85 * li.opacity);
        map.setLayoutProperty(`ov_${k}`, 'visibility', li.visible ? 'visible' : 'none');
        src.updateImage({ url: li.url, coordinates: corners });
        appliedRef.current[k] = li;
      }
    });
  }, [layers, bounds]);
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    whenReady(map, () => {
      (map.getSource('tracks') as maplibregl.GeoJSONSource | undefined)?.setData(tracksGeoJSON(tracks) as never);
      (map.getSource('roads') as maplibregl.GeoJSONSource | undefined)?.setData(roads as never);
      (map.getSource('spots') as maplibregl.GeoJSONSource | undefined)?.setData(spotsGeoJSON(spots) as never);
      (map.getSource('points') as maplibregl.GeoJSONSource | undefined)?.setData(pointsGeoJSON(points) as never);
      (map.getSource('routes') as maplibregl.GeoJSONSource | undefined)?.setData(tracksGeoJSON(routeLines) as never);
    });
  }, [tracks, roads, spots, points, routeLines]);

  // 探索計画の目印（S・G・立ち寄り地点・既存候補）: 名前つきの HTML の目印。押すとメモ・滞在。作る・直す・「ここへ行く」は 2D だけ
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const markers = routeMarks.map((m) => new maplibregl.Marker({ element: routeMarkNode(m), anchor: 'center' })
      .setLngLat([m.lng, m.lat])
      .setPopup(new maplibregl.Popup({ closeButton: true, maxWidth: '300px', offset: 12 }).setDOMContent(routeMarkDom(m)))
      .addTo(map));
    return () => { for (const m of markers) m.remove(); };
  }, [routeMarks]);

  // 予測地点: 2D と同じ見た目の HTML の目印（地形の高さに立つ）。組の表示・読み込み・削除のたびに作り直す
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const markers = candidates.map((p) => {
      // 計画を作っている間は「計画に入れる」（既存候補として足す。位置は予測地点に合わせる）
      const popup = new maplibregl.Popup({ closeButton: true, maxWidth: '300px', offset: 14 });
      popup.setDOMContent(candidateDom(p, editing ? () => { editCb.current.onEditCandidate(p); popup.remove(); } : undefined));
      return new maplibregl.Marker({ element: candidateNode(p), anchor: 'center' })
        .setLngLat([p.lng, p.lat])
        .setPopup(popup)
        .addTo(map);
    });
    // 引いて広く見ている時は紫の「？」だけ（2D と同じ）
    const syncLabels = () => {
      const show = map.getZoom() >= CANDIDATE_LABEL_MIN_ZOOM;
      for (const m of markers) { const l = m.getElement().querySelector<HTMLElement>('.cand3dLabel'); if (l) l.style.display = show ? '' : 'none'; }
    };
    syncLabels();
    map.on('zoomend', syncLabels);
    return () => { map.off('zoomend', syncLabels); for (const m of markers) m.remove(); };
  }, [candidates, editing]);

  // 作っている計画: 線と点（経由点も出す）。点はドラッグで直す（見えている地表に落ちた時だけ。隠れた所なら元に戻す）・押すと帯の一覧で選ぶ
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const pts = edit?.points ?? [];
    whenReady(map, () => {
      (map.getSource('editRoute') as maplibregl.GeoJSONSource | undefined)?.setData(tracksGeoJSON(pts.length >= 2 ? [pts.map((p) => [p.lat, p.lng] as [number, number])] : []) as never);
    });
    const markers = pts.map((p, i) => {
      const node = editPointNode(p, i, pts.length, edit?.sel === i);
      node.addEventListener('click', (ev) => { ev.stopPropagation(); editCb.current.onEditSelect(i); });
      const m = new maplibregl.Marker({ element: node, anchor: 'center', draggable: true }).setLngLat([p.lng, p.lat]).addTo(map);
      m.on('dragend', () => {
        const ll = m.getLngLat();
        if (!isVisibleGround(map, ll)) { m.setLngLat([p.lng, p.lat]); setHint('地形に隠れた所・空には動かせません。見えている地表に置いてください'); return; }
        setHint(null);
        editCb.current.onEditMove(i, ll.lat, ll.lng);
      });
      return m;
    });
    return () => { for (const m of markers) m.remove(); };
  }, [edit]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const apply = () => {
      map.setLayoutProperty('pale', 'visibility', base === 'shade' ? 'visible' : 'none');
      map.setLayoutProperty('shade', 'visibility', base === 'shade' ? 'visible' : 'none');
      map.setLayoutProperty('photo', 'visibility', base === 'photo' ? 'visible' : 'none');
    };
    whenReady(map, apply);
  }, [base]);
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const vis = (id: string, on: boolean) => { if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none'); };
    const apply = () => {
      vis('demStreams', showStreams);
      vis('twi', showTwi);
    };
    whenReady(map, apply);
  }, [showStreams, showTwi]);
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const apply = () => map.setTerrain({ source: 'dem', exaggeration: ex });
    whenReady(map, apply);
  }, [ex]);

  return (
    <div className={styles.view3d} role="dialog" aria-label="3D で見る">
      <div ref={el} className={styles.view3dMap} />
      <div className={styles.view3dBar}>
        <strong>{editing ? '3D（計画を作っています・地表を押すと点）' : '3D'}</strong>
        <span className={styles.areaName}>{areaName}</span>
        <label>背景
          <select value={base} onChange={(e) => setBase(e.target.value as 'shade' | 'photo')}>
            <option value="shade">陰影＋淡色</option>
            <option value="photo">航空写真</option>
          </select>
        </label>
        <label>高さの強調 <input type="range" min={1} max={3} step={0.1} value={ex} onChange={(e) => setEx(Number(e.target.value))} /> {ex.toFixed(1)}×</label>
        <button className={`${styles.btn} ${styles.primary}`} onClick={onClose}>2D に戻る</button>
      </div>
      {/* 左下: 凡例（初めは閉じる・押すと上へ開く）と説明文を縦に並べる（重ならない） */}
      <div className={styles.view3dBottomLeft}>
        <button className={styles.view3dLegendToggle} aria-expanded={legendOpen} onClick={toggleLegend}>凡例 {legendOpen ? '▾' : '▸'}</button>
        {legendOpen && (
          <div className={styles.view3dLegend} aria-label="水と道の凡例">
            <strong>水（別々の情報）</strong>
            <span><i className={styles.lgRiver} /> 地図の河川（地理院 1/25,000・常に表示）</span>
            {streamsUrl && <label><input type="checkbox" checked={showStreams} onChange={(e) => setShowStreams(e.target.checked)} /> <i className={styles.lgStream} /> 沢の目安（DEM の推定。実際の流れとは別）</label>}
            {twiUrl && <label><input type="checkbox" checked={showTwi} onChange={(e) => setShowTwi(e.target.checked)} /> <i className={styles.lgTwi} /> 湿りやすさ TWI（濃い = 山域の上位10%・薄い = 上位33%）</label>}
            <span><i className={styles.lgField} /> 現地で確認した水 = 「地形」の環境スポット</span>
            {candidates.length > 0 && <span><i className={styles.lgCandidate}>？</i> 予測地点（未確認・{candidates.length} 地点。押すと説明）</span>}
            <strong>道（2D の「道路・林道」「登山道・徒歩道」に従う）</strong>
            {ROAD_PAINT_3D.map((r) => (
              <span key={r.c}><i className={styles.lgRoad} style={{ background: r.dash ? `repeating-linear-gradient(90deg,${r.color} 0 ${r.dash[0] * 3}px,transparent ${r.dash[0] * 3}px ${(r.dash[0] + r.dash[1]) * 3}px)` : r.color, height: Math.max(2, r.width) }} /> {ROAD_CLASS_LABEL[r.c]}</span>
            ))}
          </div>
        )}
        <p className={styles.view3dNote}>
          右ドラッグ（Ctrl＋ドラッグ）で傾き・回転。木の点を押すと状態・観察・森・地形・水。右のパネルで条件を変えると、3D の重ね表示もそのまま変わります。
          標高は国土地理院の標高タイル（電波が必要）。記録・訂正・案内は 2D から。
        </p>
      </div>
      {error && <div className={styles.toast} role="status">{error}</div>}
      {!error && hint && <div className={styles.toast} role="status">{hint}</div>}
    </div>
  );
}
