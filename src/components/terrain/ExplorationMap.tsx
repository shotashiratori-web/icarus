import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Circle, CircleMarker, ImageOverlay, MapContainer, Polyline, Popup, TileLayer, useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useAuth } from '../../context/AuthContext';
import { fetchTerrainAreas, TerrainOfflineError } from '../../api/terrainApi';
import { TokenExpiredError } from '../../api/icarusApi';
import {
  deleteSavedArea, fetchAreaPackage, listSavedAreas, loadSavedArea, saveAreaPackage,
  type AreaPackage, type SavedArea,
} from '../../terrain/areaStore';
import { decodeGrid, decodeRoads } from '../../terrain/decode';
import {
  bearingName, cellIndex, cellValues, compileConditions, isCandidateRaw, accessClassRaw, latLngToGrid,
  nearestCandidate, candidateStats, type ExplorationConditions, type AccessClass,
} from '../../terrain/engine';
import { CUSTOM_PRESET_ID, SPECIES_PRESETS, matchPreset, presetById } from '../../terrain/presets';
import { renderOverlay, CANDIDATE_COLORS } from '../../terrain/render';
import { describeRoad, groupByClass, indexRoads, nearestRoad, TRAIL_CLASSES, VEHICLE_CLASSES, type IndexedRoads } from '../../terrain/roads';
import type { RoadLine, TerrainAreaSummary, TerrainGrid } from '../../terrain/types';
import type { FieldLogEntry } from '../../types/zukan';
import {
  displayedSourceLabel, gpsRemembered, initialPanelOpen, insideBounds, locationPermission, rememberGps, shouldAutoLocate,
} from '../../terrain/initialView';
import { buildCoverageMask, DEFAULT_COVERAGE_WIDTH, distanceToTrackM, inPeriod, type CoverageWidth, type PeriodFilter } from '../../terrain/coverage';
import { EXPLORED_COLOR } from '../../terrain/render';
import { PURPOSE_LABEL, RESULT_LABEL, type Purpose } from '../../exploration/types';
import { useExplorationHistory, type HistoryEntry } from './useExplorationHistory';
import ExplorationHistoryPanel from './ExplorationHistoryPanel';
import styles from './ExplorationMap.module.css';

// 地形探索（Exploration Mode Stage 1）。Field Map のモードの 1 つ。地図は通常モードと別に持つ（通常モードを変えない）。
// 「地形探索条件に合う場所」を出すだけで、発生を予測しない。設計: icarus_mushroom_sansai_exploration_mode_final_design.md

type Props = { entries: FieldLogEntry[] };

type Base = 'offline' | 'hillshademap' | 'std' | 'seamlessphoto';
type FieldLogFilter = 'キノコ' | '植物' | 'all' | 'none';

interface Loaded {
  pkg: AreaPackage;
  grid: TerrainGrid;
  roads: RoadLine[];
  roadIndex: IndexedRoads;
  hillshadeUrl: string;
}

const pct = (n: number) => `${n}%`;
const km2 = (v: number) => `${v < 1 ? v.toFixed(2) : v.toFixed(1)} km²`;
const fmtDate = (iso: string) => {
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

function ClickProbe({ onClick }: { onClick: (lat: number, lng: number) => void }) {
  useMapEvents({ click: (e) => onClick(e.latlng.lat, e.latlng.lng) });
  return null;
}

function FitOnce({ bounds }: { bounds: L.LatLngBoundsExpression }) {
  const map = useMap();
  const done = useRef(false);
  useEffect(() => {
    if (done.current) return;
    done.current = true;
    map.fitBounds(bounds);
  }, [map, bounds]);
  return null;
}

// 最初に現在地が取れたら現在地周辺（ズーム 15）へ。範囲の外にいる時は範囲全体のまま
function Follow({ pos, follow, bounds }: { pos: [number, number] | null; follow: boolean; bounds: { south: number; north: number; west: number; east: number } }) {
  const map = useMap();
  const first = useRef(true);
  useEffect(() => {
    if (!pos) return;
    const inside = insideBounds(bounds, pos[0], pos[1]);
    if (first.current) {
      first.current = false;
      if (inside) map.setView(pos, Math.max(map.getZoom(), 15));
    } else if (follow && inside) {
      map.panTo(pos);
    }
  }, [map, pos, follow, bounds]);
  return null;
}

export default function ExplorationMap({ entries }: Props) {
  const { idToken, handleTokenExpired, staffMe } = useAuth();

  const [status, setStatus] = useState<string>('地形データを読み込み中…');
  const [error, setError] = useState<string | null>(null);
  const [remoteAreas, setRemoteAreas] = useState<TerrainAreaSummary[] | null>(null);
  const [saved, setSaved] = useState<SavedArea | null>(null);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [saving, setSaving] = useState<string | null>(null);

  const [presetId, setPresetId] = useState<string>(SPECIES_PRESETS[0].id);
  const [conditions, setConditions] = useState<ExplorationConditions>(SPECIES_PRESETS[0].conditions);
  const [show, setShow] = useState({ A: true, B: true, C: true, ridge: false, sun: false, road: true, trail: true });
  const [fieldLogFilter, setFieldLogFilter] = useState<FieldLogFilter>('キノコ');
  const [base, setBase] = useState<Base>('offline');
  const [panelOpen, setPanelOpen] = useState(() => initialPanelOpen(typeof window === 'undefined' ? 1024 : window.innerWidth));

  const [probe, setProbe] = useState<{ lat: number; lng: number; lines: string[] } | null>(null);
  const [watching, setWatching] = useState(false);
  const [follow, setFollow] = useState(true);
  const [pos, setPos] = useState<{ lat: number; lng: number; accuracy: number } | null>(null);
  const [gpsError, setGpsError] = useState<string | null>(null);
  const watchId = useRef<number | null>(null);

  // ---- 読み込み: 保存済みがあればそれを先に使い、電波とログインがあれば新しい版を確かめる ----
  const load = useCallback(async (pkg: AreaPackage) => {
    const [grid, roads] = await Promise.all([decodeGrid(pkg), decodeRoads(pkg)]);
    setLoaded((prev) => {
      if (prev) URL.revokeObjectURL(prev.hillshadeUrl);
      return { pkg, grid, roads, roadIndex: indexRoads(roads), hillshadeUrl: URL.createObjectURL(pkg.files['hillshade.jpg']) };
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const savedList = await listSavedAreas().catch(() => [] as SavedArea[]);
        const firstSaved = savedList[0] ?? null;
        if (!cancelled) setSaved(firstSaved);
        let usedSaved = false;
        if (firstSaved) {
          const pkg = await loadSavedArea(firstSaved.areaId);
          if (pkg && !cancelled) {
            await load(pkg);
            usedSaved = true;
            setStatus('');
          }
        }
        if (!idToken) {
          if (!usedSaved && !cancelled) setError('オフライン保存したエリアがありません。電波のある所でログインして「このエリアをオフライン保存」を押してください。');
          return;
        }
        let areas: TerrainAreaSummary[];
        try {
          areas = await fetchTerrainAreas(idToken);
        } catch (e) {
          if (e instanceof TokenExpiredError) handleTokenExpired();
          if (!usedSaved && !cancelled) setError(e instanceof TerrainOfflineError ? e.message : (e as Error).message);
          return;
        }
        if (cancelled) return;
        setRemoteAreas(areas);
        const area = areas.find((a) => a.areaId === firstSaved?.areaId) ?? areas[0];
        if (!area) {
          if (!usedSaved) setError('地形データがまだ用意されていません。');
          return;
        }
        if (usedSaved && firstSaved?.version === area.version) return; // 保存済みが最新
        if (usedSaved) return; // 古い版を表示中。「更新して保存」は利用者が押す
        setStatus('地形データを取得中…');
        const pkg = await fetchAreaPackage(area, idToken, (d, t) => !cancelled && setStatus(`地形データを取得中…（${d}/${t}）`));
        if (!cancelled) {
          await load(pkg);
          setStatus('');
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : '地形データを読み込めませんでした');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [idToken, handleTokenExpired, load]);

  useEffect(() => () => {
    if (watchId.current !== null) navigator.geolocation.clearWatch(watchId.current);
  }, []);

  const manifest = loaded?.pkg.manifest ?? null;
  const cc = useMemo(() => (manifest ? compileConditions(manifest, conditions) : null), [manifest, conditions]);
  // ---- 探索履歴（Stage 2）: 「探索済み」は保存せず、絞り込んだ軌跡 × 探索幅から毎回求める ----
  const history = useExplorationHistory(idToken, manifest?.areaId ?? null);
  const [showHistory, setShowHistory] = useState(true);
  const [coverageWidth, setCoverageWidth] = useState<CoverageWidth>(DEFAULT_COVERAGE_WIDTH);
  const [purposeFilter, setPurposeFilter] = useState<Purpose | 'all'>('all');
  const [period, setPeriod] = useState<PeriodFilter>('all');
  const visibleHistory = useMemo<HistoryEntry[]>(() => history.entries.filter((e) =>
    e.track && (purposeFilter === 'all' || e.purpose === purposeFilter) && inPeriod(e.exploredOn, period, new Date())),
  [history.entries, purposeFilter, period]);
  const coverage = useMemo(() => (manifest && showHistory && visibleHistory.length > 0
    ? buildCoverageMask(manifest, visibleHistory.map((e) => e.track!), coverageWidth)
    : null), [manifest, showHistory, visibleHistory, coverageWidth]);

  const stats = useMemo(() => (manifest && loaded && cc ? candidateStats(manifest, loaded.grid, cc, coverage) : null), [manifest, loaded, cc, coverage]);

  // ---- 候補の着色（条件・表示が変わるたびに作り直す） ----
  const [overlayUrl, setOverlayUrl] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    if (!loaded || !cc || !manifest) return;
    const { grid } = loaded;
    const canvas = canvasRef.current ?? (canvasRef.current = document.createElement('canvas'));
    canvas.width = grid.width;
    canvas.height = grid.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const img = ctx.createImageData(grid.width, grid.height);
    renderOverlay(grid, cc, { candidates: { A: show.A, B: show.B, C: show.C }, ridge: show.ridge, sun: show.sun, exploredCandidates: true }, manifest.params.rel_scale, img.data, coverage);
    ctx.putImageData(img, 0, 0);
    let revoked = false;
    canvas.toBlob((blob) => {
      if (!blob || revoked) return;
      const url = URL.createObjectURL(blob);
      setOverlayUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return url;
      });
    });
    return () => {
      revoked = true;
    };
  }, [loaded, cc, manifest, show.A, show.B, show.C, show.ridge, show.sun, coverage]);

  const bounds = useMemo<L.LatLngBoundsExpression | null>(() => (manifest
    ? [[manifest.bounds.south, manifest.bounds.west], [manifest.bounds.north, manifest.bounds.east]]
    : null), [manifest]);
  // 範囲の外へ遠く離れないようにする（外側はデータなし）
  const maxBounds = useMemo<L.LatLngBoundsExpression | null>(() => (manifest
    ? [[manifest.bounds.south - 0.05, manifest.bounds.west - 0.07], [manifest.bounds.north + 0.05, manifest.bounds.east + 0.07]]
    : null), [manifest]);
  const roadGroups = useMemo(() => (loaded ? groupByClass(loaded.roads) : null), [loaded]);

  const logPoints = useMemo(() => {
    if (fieldLogFilter === 'none') return [];
    return entries.filter((e) => fieldLogFilter === 'all' || e.largeCategory === fieldLogFilter);
  }, [entries, fieldLogFilter]);

  // ---- タップした地点の情報 ----
  const describePoint = useCallback((lat: number, lng: number): string[] => {
    if (!loaded || !manifest || !cc) return [];
    const { x, y } = latLngToGrid(manifest, lat, lng);
    const i = cellIndex(loaded.grid, x, y);
    if (i === null) return ['地形探索の範囲外です'];
    const v = cellValues(manifest, loaded.grid, i);
    if (!v.land) return ['海（データなし）'];
    const lines: string[] = [];
    if (isCandidateRaw(loaded.grid, i, cc)) {
      const k = accessClassRaw(loaded.grid, i, cc);
      const explored = coverage ? coverage[i] === 1 : false;
      lines.push(`条件に合う場所 ${k}（${{ A: '車道・林道から100m以内', B: '徒歩道から300m以内', C: '道から離れている' }[k]}）${explored ? '・探索済み' : coverage ? '・未探索' : ''}`);
    }
    lines.push(`傾斜 ${Math.round(v.slopeDeg)}°`);
    lines.push(`日射 ${v.sun.toFixed(2)}（水平=1.00）`);
    lines.push(`尾根線から ${v.ridgeM === null ? '200m以上' : `約${Math.round(v.ridgeM / 10) * 10}m`}`);
    lines.push(`最寄りの車道・林道 ${describeRoad(nearestRoad(loaded.roadIndex, lat, lng, VEHICLE_CLASSES))}`);
    lines.push(`最寄りの登山道・徒歩道 ${describeRoad(nearestRoad(loaded.roadIndex, lat, lng, TRAIL_CLASSES))}`);
    if (showHistory) {
      // この地点を探索範囲（線から探索幅）に含むセッションを全部出す（日付・目的・歩いた人・対象の結果）
      const near = visibleHistory.filter((e) => e.track && distanceToTrackM(lat, lng, e.track) <= coverageWidth);
      if (near.length === 0) lines.push(`過去探索 なし（${coverageWidth}m・この絞り込み）`);
      for (const e of near.slice(0, 5)) {
        const t = e.targets.map((x) => `${x.target}: ${RESULT_LABEL[x.result]}`).join('、');
        lines.push(`過去探索 ${e.exploredOn ?? '日付なし'}・${e.explorerNames.join('、') || '—'}・${PURPOSE_LABEL[e.purpose]}${t ? `（${t}）` : ''}${e.origin === 'device' ? '・端末のみ' : ''}`);
      }
      if (near.length > 5) lines.push(`ほか ${near.length - 5} 件`);
    }
    return lines;
  }, [loaded, manifest, cc, coverage, showHistory, visibleHistory, coverageWidth]);

  const onMapClick = useCallback((lat: number, lng: number) => setProbe({ lat, lng, lines: describePoint(lat, lng) }), [describePoint]);
  // 条件を変えたら、開いている地点情報も今の条件で出し直す
  useEffect(() => {
    setProbe((p) => (p ? { ...p, lines: describePoint(p.lat, p.lng) } : p));
  }, [describePoint]);

  // ---- 現在地 ----
  const stopGps = () => {
    if (watchId.current !== null) navigator.geolocation.clearWatch(watchId.current);
    watchId.current = null;
    setWatching(false);
  };
  const startGps = useCallback(() => {
    if (watchId.current !== null) return;
    if (!('geolocation' in navigator)) {
      setGpsError('この端末では現在地を取得できません');
      return;
    }
    setGpsError(null);
    setWatching(true);
    watchId.current = navigator.geolocation.watchPosition(
      (p) => setPos({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy }),
      (e) => setGpsError(e.code === e.PERMISSION_DENIED ? '位置情報が許可されていません（設定で Icarus の位置情報を許可してください）' : '現在地を取得できませんでした。空の見える場所で少し待ってください'),
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 30000 },
    );
  }, []);
  const toggleGps = () => {
    if (watchId.current !== null) {
      stopGps();
      rememberGps(false);
    } else {
      startGps();
      rememberGps(true);
    }
  };
  // 開いた時: 許可済み、または前回使っていたら自動で現在地を取る（初めての人には開いた瞬間に許可を求めない）
  const hasArea = !!loaded;
  useEffect(() => {
    if (!hasArea) return;
    let cancelled = false;
    void locationPermission().then((perm) => {
      if (!cancelled && shouldAutoLocate(perm, gpsRemembered())) startGps();
    });
    return () => {
      cancelled = true;
    };
  }, [hasArea, startGps]);
  const nearest = useMemo(() => (pos && manifest && loaded && cc ? nearestCandidate(manifest, loaded.grid, cc, pos.lat, pos.lng, 2500, coverage) : null), [pos, manifest, loaded, cc, coverage]);
  const hereLines = useMemo(() => (pos ? describePoint(pos.lat, pos.lng) : []), [pos, describePoint]);

  // ---- オフライン保存 ----
  const currentRemote = remoteAreas?.find((a) => a.areaId === (manifest?.areaId ?? remoteAreas[0]?.areaId)) ?? remoteAreas?.[0];
  const savedIsLatest = !!saved && !!currentRemote && saved.version === currentRemote.version;
  const handleSave = async () => {
    if (!currentRemote || !idToken) return;
    setSaving('保存中…');
    setError(null);
    try {
      const pkg = loaded && loaded.pkg.manifest.version === currentRemote.version
        ? loaded.pkg
        : await fetchAreaPackage(currentRemote, idToken, (d, t) => setSaving(`保存中…（${d}/${t}）`));
      const s = await saveAreaPackage(pkg);
      setSaved(s);
      if (loaded?.pkg.manifest.version !== s.version) await load(pkg);
    } catch (e) {
      if (e instanceof TokenExpiredError) handleTokenExpired();
      setError(e instanceof Error ? e.message : '保存できませんでした');
    } finally {
      setSaving(null);
    }
  };
  const handleDelete = async () => {
    if (!saved) return;
    await deleteSavedArea(saved.areaId);
    setSaved(null);
  };

  const setCondition = (patch: Partial<ExplorationConditions>) => {
    const next = { ...conditions, ...patch };
    setConditions(next);
    setPresetId(matchPreset(next));
  };
  const choosePreset = (id: string) => {
    setPresetId(id);
    const p = presetById(id);
    if (p) setConditions(p.conditions);
  };

  const onlineBase = base !== 'offline';
  const attribution = '<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank" rel="noreferrer">国土地理院</a> | © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap contributors</a>';

  if (error && !loaded) {
    return <div className={styles.message}><p>{error}</p></div>;
  }
  if (!loaded || !manifest || !bounds) {
    return <div className={styles.message}><p>{status || '地形データを読み込み中…'}</p></div>;
  }

  return (
    <div className={styles.root}>
      <MapContainer className={styles.map} bounds={bounds} maxBounds={maxBounds ?? undefined} maxBoundsViscosity={0.8} minZoom={10} preferCanvas zoomControl attributionControl>
        <FitOnce bounds={bounds} />
        {onlineBase && (
          <TileLayer
            key={base}
            url={`https://cyberjapandata.gsi.go.jp/xyz/${base}/{z}/{x}/{y}.${base === 'seamlessphoto' ? 'jpg' : 'png'}`}
            maxZoom={18}
            attribution={attribution}
          />
        )}
        {!onlineBase && <ImageOverlay url={loaded.hillshadeUrl} bounds={bounds} attribution={attribution} />}
        {overlayUrl && <ImageOverlay url={overlayUrl} bounds={bounds} opacity={1} zIndex={5} />}
        {roadGroups && show.road && (
          <>
            <Polyline positions={roadGroups.road} pathOptions={{ color: '#495057', weight: 1.6, opacity: 0.9, interactive: false }} />
            <Polyline positions={roadGroups.narrow} pathOptions={{ color: '#8d5524', weight: 1.3, opacity: 0.85, dashArray: '6 3', interactive: false }} />
            <Polyline positions={roadGroups.forest} pathOptions={{ color: '#8d5524', weight: 2.6, opacity: 0.95, interactive: false }} />
          </>
        )}
        {roadGroups && show.trail && (
          <Polyline positions={roadGroups.trail} pathOptions={{ color: '#212529', weight: 2, opacity: 0.9, dashArray: '2 5', lineCap: 'round', interactive: false }} />
        )}
        {showHistory && visibleHistory.map((e) => (
          <Polyline key={`${e.key}-casing`} positions={e.track!} pathOptions={{ color: '#fff', weight: 7, opacity: 0.9, interactive: false }} />
        ))}
        {showHistory && visibleHistory.map((e) => (
          <Polyline key={e.key} positions={e.track!} pathOptions={{ color: '#1a73e8', weight: 4, opacity: 1, dashArray: e.origin === 'device' && e.status !== 'registered' ? '8 6' : undefined }}>
            <Popup>
              <b>{e.exploredOn ?? '日付なし'}・{PURPOSE_LABEL[e.purpose]}</b><br />
              {e.explorerNames.join('、') || '歩いた人未記入'}・{e.distanceM >= 1000 ? `${(e.distanceM / 1000).toFixed(1)}km` : `${Math.round(e.distanceM)}m`}<br />
              {e.targets.map((t) => `${t.target}: ${RESULT_LABEL[t.result]}`).join('、') || '対象未記入'}
              {e.origin === 'device' && <><br />この端末のみ（{e.status === 'registered' ? '登録済み' : '未登録'}）</>}
            </Popup>
          </Polyline>
        ))}
        {logPoints.map((e) => (
          <CircleMarker key={e.id} center={[e.lat, e.lng]} radius={6} pathOptions={{ color: '#fff', weight: 1.5, fillColor: '#2b8a3e', fillOpacity: 0.9 }}>
            <Popup><b>{e.foodName || '無題'}</b><br />{e.date}{e.place ? `・${e.place}` : ''}</Popup>
          </CircleMarker>
        ))}
        {probe && <CircleMarker center={[probe.lat, probe.lng]} radius={5} pathOptions={{ color: '#8d5524', weight: 2, fill: false }} />}
        {pos && (
          <>
            <Circle center={[pos.lat, pos.lng]} radius={pos.accuracy} pathOptions={{ color: '#1a73e8', weight: 1, fillOpacity: 0.1, interactive: false }} />
            <CircleMarker center={[pos.lat, pos.lng]} radius={8} pathOptions={{ color: '#fff', weight: 3, fillColor: '#1a73e8', fillOpacity: 1 }} />
          </>
        )}
        <Follow pos={pos ? [pos.lat, pos.lng] : null} follow={follow} bounds={manifest.bounds} />
        <ClickProbe onClick={onMapClick} />
      </MapContainer>

      <section className={`${styles.panel} ${panelOpen ? '' : styles.collapsed}`} aria-label="地形探索の条件と操作">
        <div className={styles.panelHead}>
          <strong>地形探索</strong>
          <span className={styles.areaName}>{manifest.name}</span>
          <button className={styles.btn} onClick={() => setPanelOpen((v) => !v)} aria-expanded={panelOpen}>{panelOpen ? '閉じる' : '条件・操作'}</button>
        </div>

        {panelOpen && (
          <div className={styles.panelBody}>
            <div className={styles.row}>
              <button className={`${styles.btn} ${styles.primary}`} onClick={toggleGps}>{watching ? '現在地を止める' : '現在地を表示'}</button>
              <label className={styles.check}><input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} />追従</label>
            </div>
            {gpsError && <p className={styles.warn}>{gpsError}</p>}
            {pos && (
              <p className={styles.here}>
                {nearest ? `最寄りの条件に合う場所（${nearest.access}）: 約${Math.round(nearest.distanceM / 10) * 10}m ${bearingName(nearest.bearingDeg)}` : '約2.5km以内に条件に合う場所なし'}
                {` ／ 精度 ±${Math.round(pos.accuracy)}m`}
                {hereLines.length > 0 && <><br />ここ: {hereLines.filter((l) => l.startsWith('傾斜') || l.startsWith('日射')).join('・')}</>}
              </p>
            )}

            <h3 className={styles.h}>探索条件</h3>
            <select className={styles.select} value={presetId} onChange={(e) => choosePreset(e.target.value)} aria-label="探索のプリセット">
              {SPECIES_PRESETS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
              <option value={CUSTOM_PRESET_ID}>条件を自分で決める</option>
            </select>
            <p className={styles.sub}>{presetById(presetId)?.description ?? '下の条件を自由に変えられます'}</p>

            <label className={styles.slider}>
              <span>傾斜 <b>{conditions.slopeMinDeg}° 以上</b></span>
              <input type="range" min={10} max={45} step={1} value={conditions.slopeMinDeg} onChange={(e) => setCondition({ slopeMinDeg: Number(e.target.value) })} />
            </label>
            <label className={styles.slider}>
              <span>日射 <b>上位 {pct(conditions.sunTopPct)}</b></span>
              <input type="range" min={10} max={50} step={10} value={conditions.sunTopPct} onChange={(e) => setCondition({ sunTopPct: Number(e.target.value) as ExplorationConditions['sunTopPct'] })} />
            </label>
            <label className={styles.slider}>
              <span>尾根線から <b>{conditions.ridgeMaxM <= 0 ? '尾根線の上のみ' : `約${Math.round(conditions.ridgeMaxM)}m 以内`}</b></span>
              <input
                type="range" min={0} max={10} step={1}
                value={Math.round(conditions.ridgeMaxM / manifest.grid.pxM)}
                onChange={(e) => setCondition({ ridgeMaxM: Math.round(Number(e.target.value) * manifest.grid.pxM) })}
              />
            </label>

            <h3 className={styles.h}>条件に合う場所</h3>
            {(['A', 'B', 'C'] as AccessClass[]).map((k) => (
              <label key={k} className={styles.check}>
                <input type="checkbox" checked={show[k]} onChange={(e) => setShow((s) => ({ ...s, [k]: e.target.checked }))} />
                <span className={styles.swatch} style={{ background: `rgb(${CANDIDATE_COLORS[k].join(',')})` }} />
                {k} {{ A: '車道・林道から100m以内（気軽に確認）', B: '徒歩道から300m以内（徒歩で探索）', C: '道から離れている' }[k]}
                {stats && <span className={styles.num}>{coverage ? `未探索 ${km2(stats.km2[k])}` : km2(stats.km2[k])}</span>}
              </label>
            ))}

            {coverage && (
              <label className={styles.check}>
                <span className={styles.swatch} style={{ background: `rgb(${EXPLORED_COLOR.join(',')})` }} />探索済み（探索範囲 {coverageWidth}m）
                {stats && <span className={styles.num}>{km2(stats.exploredKm2.total)}</span>}
              </label>
            )}

            <ExplorationHistoryPanel
              history={history}
              staffName={staffMe?.displayName ?? ''}
              show={showHistory}
              onShowChange={setShowHistory}
              width={coverageWidth}
              onWidthChange={setCoverageWidth}
              purposeFilter={purposeFilter}
              onPurposeFilterChange={setPurposeFilter}
              period={period}
              onPeriodChange={setPeriod}
              exploredKm2={stats && coverage ? stats.exploredKm2.total : null}
            />

            <h3 className={styles.h}>重ねる情報</h3>
            <label className={styles.check}><input type="checkbox" checked={show.ridge} onChange={(e) => setShow((s) => ({ ...s, ridge: e.target.checked }))} /><span className={styles.swatch} style={{ background: '#7b2cbf' }} />尾根線</label>
            <label className={styles.check}><input type="checkbox" checked={show.sun} onChange={(e) => setShow((s) => ({ ...s, sun: e.target.checked }))} /><span className={styles.swatch} style={{ background: 'linear-gradient(90deg,#1c3f95,#f6d743)' }} />日射量</label>
            <label className={styles.check}><input type="checkbox" checked={show.road} onChange={(e) => setShow((s) => ({ ...s, road: e.target.checked }))} /><span className={styles.line} style={{ background: '#495057' }} />道路・林道<span className={styles.sub}>（茶=林道・幅3m未満）</span></label>
            <label className={styles.check}><input type="checkbox" checked={show.trail} onChange={(e) => setShow((s) => ({ ...s, trail: e.target.checked }))} /><span className={styles.line} style={{ background: 'repeating-linear-gradient(90deg,#212529 0 3px,transparent 3px 6px)' }} />登山道・徒歩道</label>
            <label className={styles.check}>
              <span className={styles.swatch} style={{ background: '#2b8a3e', borderRadius: '50%' }} />Field Log
              <select className={styles.selectSmall} value={fieldLogFilter} onChange={(e) => setFieldLogFilter(e.target.value as FieldLogFilter)} aria-label="Field Log の表示">
                <option value="キノコ">きのこ</option>
                <option value="植物">植物（山菜など）</option>
                <option value="all">すべて</option>
                <option value="none">表示しない</option>
              </select>
              <span className={styles.num}>{logPoints.length}件</span>
            </label>
            {entries.length === 0 && <p className={styles.sub}>Field Log はログイン中・読み込み済みのときだけ表示されます</p>}

            <h3 className={styles.h}>背景</h3>
            <select className={styles.select} value={base} onChange={(e) => setBase(e.target.value as Base)} aria-label="背景">
              <option value="offline">陰影（オフラインで使える）</option>
              <option value="hillshademap">国土地理院 陰影起伏図（要電波）</option>
              <option value="std">国土地理院 標準地図（要電波）</option>
              <option value="seamlessphoto">国土地理院 航空写真（要電波）</option>
            </select>

            <h3 className={styles.h}>オフライン</h3>
            {saved ? (
              <p className={styles.sub}>
                オフライン保存済み（{fmtDate(saved.savedAt)}・約{(saved.bytes / 1e6).toFixed(1)}MB）
                {currentRemote && !savedIsLatest && <><br /><b>新しい版があります</b></>}
              </p>
            ) : (
              <p className={styles.sub}>まだ保存していません。山に入る前に保存してください。</p>
            )}
            <div className={styles.row}>
              {(!saved || !savedIsLatest) && (
                <button className={`${styles.btn} ${styles.primary}`} onClick={() => void handleSave()} disabled={!!saving || !idToken || !currentRemote}>
                  {saving ?? (saved ? '更新して保存' : 'このエリアをオフライン保存')}
                </button>
              )}
              {saved && <button className={styles.btn} onClick={() => void handleDelete()} disabled={!!saving}>保存を削除</button>}
            </div>
            {error && <p className={styles.warn}>{error}</p>}
            <p className={styles.sub}>表示中: {displayedSourceLabel(manifest.version, saved?.version ?? null)}・{manifest.version}</p>

            <details className={styles.details}>
              <summary>計算の方法と注意</summary>
              <p className={styles.sub}>
                標高は国土地理院 DEM10 を約{Math.round(manifest.grid.pxM)}m 間隔にまとめて計算。日射は {manifest.params.date} の 1 日分（4〜19時、隣の尾根の影を含む直射。雲・樹冠・散乱光は含まない）。
                尾根線は周囲より高い凸部。道は国土地理院と OpenStreetMap（地図に無い作業道・踏み跡は出ない。廃道・通行止めも道として数える）。
                <b>発生を予測するものではなく、探す場所を絞るための地形の手がかりです。</b>
              </p>
              <p className={styles.sub}>出典: {manifest.sources.map((s) => s.name).join('、')}</p>
            </details>
          </div>
        )}
      </section>

      {probe && (
        <div className={styles.probe} role="status">
          <button className={styles.probeClose} onClick={() => setProbe(null)} aria-label="閉じる">×</button>
          {probe.lines.map((l) => <div key={l}>{l}</div>)}
        </div>
      )}
      {status && <div className={styles.toast}>{status}</div>}
      {!status && watching && !pos && !gpsError && <div className={styles.toast}>現在地を取得中…</div>}
    </div>
  );
}
