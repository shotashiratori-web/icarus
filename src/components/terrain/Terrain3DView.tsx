import { useEffect, useRef, useState } from 'react';
import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import { gsiToTerrarium } from '../../terrain/gsiDem';
import type { TerrainBounds } from '../../terrain/types';
import styles from './ExplorationMap.module.css';

// 3D（PC だけ・見るだけ）。設計: icarus_3d_terrain_view_technical_audit.md §8（3D-1）
// - 標高は国土地理院 標高タイル dem_png を直接（電波が必要）。地形パッケージ・R2 は変えない
// - 2D で今表示している層の画像を、同じ範囲の 4 隅に貼る（同じ関数で作った canvas の画像）
// - 探索履歴 GPX・環境スポット（木など）・Field Log の点。記録・訂正・案内は 2D から
// このファイルと MapLibre は asset-manifest から外す（iPhone に保存させない。build/assetManifest.ts）

export interface Spot3D { lat: number; lng: number; label: string; color: string; mizunara: boolean }
export interface Point3D { lat: number; lng: number; label: string }
export interface Terrain3DProps {
  bounds: TerrainBounds;
  overlays: string[]; // 2D の層の画像（object URL）。下から順
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

export default function Terrain3DView({ bounds, overlays, tracks, spots, points, initial, areaName, onClose }: Terrain3DProps) {
  const el = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const [base, setBase] = useState<'shade' | 'photo'>('shade');
  const [ex, setEx] = useState(1.5);
  const [error, setError] = useState<string | null>(null);

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
          tracks: { type: 'geojson', data: { type: 'Feature', properties: {}, geometry: { type: 'MultiLineString', coordinates: tracks.map((t) => t.map(([la, ln]) => [ln, la])) } } },
          spots: { type: 'geojson', data: { type: 'FeatureCollection', features: spots.map((s) => ({ type: 'Feature', properties: { label: s.label, color: s.color, mizunara: s.mizunara }, geometry: { type: 'Point', coordinates: [s.lng, s.lat] } })) } },
          points: { type: 'geojson', data: { type: 'FeatureCollection', features: points.map((p) => ({ type: 'Feature', properties: { label: p.label }, geometry: { type: 'Point', coordinates: [p.lng, p.lat] } })) } },
        },
        layers: [
          { id: 'pale', type: 'raster', source: 'pale' },
          { id: 'shade', type: 'raster', source: 'shade', paint: { 'raster-opacity': 0.55 } },
          { id: 'photo', type: 'raster', source: 'photo', layout: { visibility: 'none' } },
          ...overlays.map((_, i) => ({ id: `ov${i}`, type: 'raster' as const, source: `ov${i}`, paint: { 'raster-opacity': 0.85, 'raster-fade-duration': 0 } })),
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
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right');
    map.addControl(new maplibregl.ScaleControl(), 'bottom-left');
    map.on('error', (e) => { if (!navigator.onLine) setError('3D は電波が必要です（地理院の標高を読みます）'); else console.warn('[3d]', e.error?.message); });
    for (const id of ['spots', 'points']) {
      map.on('click', id, (e) => {
        const f = e.features?.[0];
        if (!f) return;
        new maplibregl.Popup({ closeButton: false }).setLngLat(e.lngLat).setText(String(f.properties?.label ?? '')).addTo(map);
      });
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
    if (map.isStyleLoaded()) apply(); else map.once('load', apply);
  }, [base]);
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const apply = () => map.setTerrain({ source: 'dem', exaggeration: ex });
    if (map.isStyleLoaded()) apply(); else map.once('load', apply);
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
      <p className={styles.view3dNote}>
        右ドラッグ（Ctrl＋ドラッグ）で傾き・回転。点を押すと名前。2D で表示中の層・探索履歴・環境スポット（木など）・Field Log を重ねています。
        標高は国土地理院の標高タイル（電波が必要）。記録・訂正・案内は 2D から。
      </p>
      {error && <div className={styles.toast} role="status">{error}</div>}
    </div>
  );
}
