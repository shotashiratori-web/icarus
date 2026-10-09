import { useEffect, useRef, useState } from 'react';
import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import { gsiToTerrarium } from '../../terrain/gsiDem';
import { markReadyOnLoad, whenReady } from '../../terrain/mapReady';
import type { Inspector } from '../../terrain/forestWater';
import { GSI_VECTOR_TILES, mapRiverText, nearestMapRiver, RIVER_CENTER_CODES, RIVER_EDGE_CODES } from '../../terrain/gsiRivers';
import type { TerrainBounds } from '../../terrain/types';
import styles from './ExplorationMap.module.css';

// 3D（PC だけ・見るだけ）。設計: icarus_3d_terrain_view_technical_audit.md §8（3D-1）
// - 標高は国土地理院 標高タイル dem_png を直接（電波が必要）。地形パッケージ・R2 は変えない
// - 2D で今表示している層の画像を、同じ範囲の 4 隅に貼る（同じ関数で作った canvas の画像）
// - 探索履歴 GPX・環境スポット（木など）・Field Log の点。記録・訂正・案内は 2D から
// - 3D-2 Forest & Water Context: 木を押すと状態・観察・森・地形・水（読み取り専用）。水は 地図の河川／沢の目安（DEM）／湿りやすさ（TWI）を分けて重ねる
//   設計: icarus_3d2_forest_water_context_audit.md
// このファイルと MapLibre は asset-manifest から外す（iPhone に保存させない。build/assetManifest.ts）

export interface Spot3D { lat: number; lng: number; label: string; color: string; mizunara: boolean; inspector: Inspector }
export interface Point3D { lat: number; lng: number; label: string }
export interface Terrain3DProps {
  bounds: TerrainBounds;
  overlays: string[]; // 2D の層の画像（object URL）。下から順
  twiUrl: string | null; // 湿りやすさ（TWI 上位 33%・10%）
  streamsUrl: string | null; // 沢の目安（DEM。3D では水色）
  tracks: [number, number][][]; // [lat, lng]
  spots: Spot3D[];
  points: Point3D[];
  initial: { lat: number; lng: number; zoom: number };
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

export default function Terrain3DView({ bounds, overlays, twiUrl, streamsUrl, tracks, spots, points, initial, areaName, onClose }: Terrain3DProps) {
  const el = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const [base, setBase] = useState<'shade' | 'photo'>('shade');
  const [ex, setEx] = useState(1.5);
  const [error, setError] = useState<string | null>(null);
  const [showStreams, setShowStreams] = useState(true);
  const [showTwi, setShowTwi] = useState(true);
  const exRef = useRef(1.5);
  exRef.current = ex;

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
          ...Object.fromEntries(overlays.map((url, i) => [`ov${i}`, { type: 'image' as const, url, coordinates: corners }])),
          ...(twiUrl ? { twi: { type: 'image' as const, url: twiUrl, coordinates: corners } } : {}),
          ...(streamsUrl ? { demStreams: { type: 'image' as const, url: streamsUrl, coordinates: corners } } : {}),
          gsivec: { type: 'vector', tiles: [GSI_VECTOR_TILES], minzoom: 4, maxzoom: 16, attribution: '国土地理院（ベクトルタイル）' },
          tracks: { type: 'geojson', data: { type: 'Feature', properties: {}, geometry: { type: 'MultiLineString', coordinates: tracks.map((t) => t.map(([la, ln]) => [ln, la])) } } },
          spots: { type: 'geojson', data: { type: 'FeatureCollection', features: spots.map((s, i) => ({ type: 'Feature', properties: { idx: i, label: s.label, color: s.color, mizunara: s.mizunara }, geometry: { type: 'Point', coordinates: [s.lng, s.lat] } })) } },
          points: { type: 'geojson', data: { type: 'FeatureCollection', features: points.map((p) => ({ type: 'Feature', properties: { label: p.label }, geometry: { type: 'Point', coordinates: [p.lng, p.lat] } })) } },
        },
        layers: [
          { id: 'pale', type: 'raster', source: 'pale' },
          { id: 'shade', type: 'raster', source: 'shade', paint: { 'raster-opacity': 0.55 } },
          { id: 'photo', type: 'raster', source: 'photo', layout: { visibility: 'none' } },
          ...(twiUrl ? [{ id: 'twi', type: 'raster' as const, source: 'twi', paint: { 'raster-opacity': 1, 'raster-fade-duration': 0 } }] : []),
          ...overlays.map((_, i) => ({ id: `ov${i}`, type: 'raster' as const, source: `ov${i}`, paint: { 'raster-opacity': 0.85, 'raster-fade-duration': 0 } })),
          ...(streamsUrl ? [{ id: 'demStreams', type: 'raster' as const, source: 'demStreams', paint: { 'raster-opacity': 1, 'raster-fade-duration': 0 } }] : []),
          // 地図の河川（地理院 1/25,000）: 水域・岸は薄い青、中心線は濃紺の実線
          { id: 'river-area', type: 'fill', source: 'gsivec', 'source-layer': 'waterarea', paint: { 'fill-color': '#90caf9', 'fill-opacity': 0.6 } },
          { id: 'river-edge', type: 'line', source: 'gsivec', 'source-layer': 'river', filter: ['in', ['get', 'ftCode'], ['literal', RIVER_EDGE_CODES]], paint: { 'line-color': '#64b5f6', 'line-width': 1.2 } },
          { id: 'river-line', type: 'line', source: 'gsivec', 'source-layer': 'river', filter: ['in', ['get', 'ftCode'], ['literal', RIVER_CENTER_CODES]], paint: { 'line-color': '#0d47a1', 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 1.2, 15, 2.8] } },
          { id: 'tracks-casing', type: 'line', source: 'tracks', paint: { 'line-color': '#fff', 'line-width': 6, 'line-opacity': 0.85 } },
          { id: 'tracks', type: 'line', source: 'tracks', paint: { 'line-color': '#1a73e8', 'line-width': 3.5 } },
          { id: 'points', type: 'circle', source: 'points', paint: { 'circle-radius': 5, 'circle-color': '#2b8a3e', 'circle-stroke-color': '#fff', 'circle-stroke-width': 1.5 } },
          { id: 'spots', type: 'circle', source: 'spots', paint: {
            'circle-radius': 8, 'circle-color': ['get', 'color'],
            'circle-stroke-color': ['case', ['get', 'mizunara'], '#f9a825', '#ffffff'], 'circle-stroke-width': ['case', ['get', 'mizunara'], 3, 1.5],
          } },
        ],
        terrain: { source: 'dem', exaggeration: 1.5 },
      },
    });
    mapRef.current = map;
    markReadyOnLoad(map);
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right');
    map.addControl(new maplibregl.ScaleControl(), 'bottom-left');
    map.on('error', (e) => { if (!navigator.onLine) setError('3D は電波が必要です（地理院の標高を読みます）'); else console.warn('[3d]', e.error?.message); });
    map.on('click', 'points', (e) => {
      const f = e.features?.[0];
      if (!f) return;
      new maplibregl.Popup({ closeButton: false }).setLngLat(e.lngLat).setText(String(f.properties?.label ?? '')).addTo(map);
    });
    map.on('click', 'spots', (e) => {
      const f = e.features?.[0];
      const s = f ? spots[Number(f.properties?.idx)] : undefined;
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
    // 開いた時の内容で作る（2D に戻って開き直すと最新になる）
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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
        <strong>3D（見るだけ）</strong>
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
      <div className={styles.view3dLegend} aria-label="水の凡例">
        <strong>水（別々の情報）</strong>
        <span><i className={styles.lgRiver} /> 地図の河川（地理院 1/25,000・常に表示）</span>
        {streamsUrl && <label><input type="checkbox" checked={showStreams} onChange={(e) => setShowStreams(e.target.checked)} /> <i className={styles.lgStream} /> 沢の目安（DEM の推定。実際の流れとは別）</label>}
        {twiUrl && <label><input type="checkbox" checked={showTwi} onChange={(e) => setShowTwi(e.target.checked)} /> <i className={styles.lgTwi} /> 湿りやすさ TWI（濃い = 山域の上位10%・薄い = 上位33%）</label>}
        <span><i className={styles.lgField} /> 現地で確認した水 = 「地形」の環境スポット</span>
      </div>
      <p className={styles.view3dNote}>
        右ドラッグ（Ctrl＋ドラッグ）で傾き・回転。木の点を押すと状態・観察・森・地形・水。2D で表示中の層・探索履歴・環境スポット（木など）・Field Log を重ねています。
        標高は国土地理院の標高タイル（電波が必要）。記録・訂正・案内は 2D から。
      </p>
      {error && <div className={styles.toast} role="status">{error}</div>}
    </div>
  );
}
