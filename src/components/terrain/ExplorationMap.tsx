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
import { decodeGrid, decodeRoads, pixels } from '../../terrain/decode';
import {
  anyForestLayer, FOREST_CLASS, forestHeadline, FOREST_COLORS, forestAreaHa, forestFromPixels, mizunaraCommunities, NO_FOREST_LAYERS, parseForestJson, renderForest, vegColor,
  type ForestData, type ForestLayers, type ForestStand,
} from '../../terrain/forest';
import {
  anyTerrainCondition, describeHydro, DIRECTION_LABEL, summarizeTerrain, DIRECTIONS, hydroFromPixels, LANDFORMS, NO_TERRAIN_CONDITIONS, renderHydro, STREAM_COLOR, TERRAIN_MATCH_COLOR, WETNESS_LABEL,
  type Direction, type HydroGrid, type TerrainConditions, type Wetness,
} from '../../terrain/hydro';
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
import { buildCoverageMask, COVERAGE_WIDTHS_M, DEFAULT_COVERAGE_WIDTH, distanceToTrackM, inPeriod, type CoverageWidth, type PeriodFilter } from '../../terrain/coverage';
import { EXPLORED_COLOR } from '../../terrain/render';
import { PURPOSE_LABEL, RESULT_LABEL, type Purpose } from '../../exploration/types';
import { useExplorationHistory, type HistoryEntry } from './useExplorationHistory';
import ExplorationHistoryPanel from './ExplorationHistoryPanel';
import ContourLayer from './ContourLayer';
import { APP_BUILD } from '../../appBuild';
import { useEnvironmentSpots, type SpotMarker } from './useEnvironmentSpots';
import EnvironmentSpotRecordSheet, { NO_GPS_HINT, type RecordLocation } from './EnvironmentSpotRecordSheet';
import EnvironmentSpotDetailSheet from './EnvironmentSpotDetailSheet';
import { KIND_CHOICES, type PendingPhoto, type SpotKindChoice } from '../../environmentSpots/types';
import { readPhotoMeta } from '../../environmentSpots/photoMeta';
import { photoFromFile } from '../../environmentSpots/sync';
import { aspectDeg as hydroAspectDeg, directionOf as hydroDirectionOf, LANDFORMS as HYDRO_LANDFORMS, twiValue as hydroTwiValue } from '../../terrain/hydro';
import { coordText, googleMapsDirectionsUrl, googleMapsPinUrl } from '../../terrain/externalMaps';
import { headingFromEvent, headingLabel, requestOrientationPermission, rotorSize, screenToMapPoint, smoothAngle } from '../../terrain/heading';
import { ALL_SPECIES, filterBySpecies, speciesKey, speciesOptions } from '../../terrain/speciesFilter';
import { CONTOUR_STYLE, decodeContours, LABEL_MIN_ZOOM, MAJOR_MIN_ZOOM, MINOR_MIN_ZOOM, type Contours } from '../../terrain/contours';
import {
  buildTargetExploration, describeTargetAt, DEFAULT_POINT_RADIUS_M, renderTargetExploration, stateAreasKm2, STATE_LABEL, STATE_LABEL_NO_TARGET,
  type ExplorationState, type PointEvidence, type TargetSpec, type TrackEvidence,
} from '../../terrain/targetExploration';
import {
  buildSnapshot, compileHypothesis, computeMatch, describeConditions, GROUP_LABEL, NO_HYPOTHESIS_CONDITIONS, renderMatch, suggestName,
  type HypothesisConditions, type HypothesisSnapshot,
} from '../../terrain/hypothesis';
import { deleteHypothesis, listHypotheses, saveHypothesis } from '../../exploration/hypothesisStore';
import HypothesisPanel from './HypothesisPanel';
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
  forest: ForestData | null; // 2026-09-29 より前の版には無い
  forestError: string | null;
  hydro: HydroGrid | null; // DEM 由来の地形（terrain2.png）。無い版もある
  hydroError: string | null;
}

async function decodeHydroPkg(pkg: AreaPackage): Promise<{ hydro: HydroGrid | null; hydroError: string | null }> {
  const png = pkg.files['terrain2.png'];
  if (!png) return { hydro: null, hydroError: null };
  try {
    const px = await pixels(png);
    return { hydro: hydroFromPixels(pkg.manifest, px.data, px.width, px.height), hydroError: null };
  } catch (e) {
    return { hydro: null, hydroError: e instanceof Error ? e.message : '地形（方位・沢）を読めませんでした' };
  }
}

// 森林（forest.png + forest.json）。読めなくても地形探索は使えるようにする
async function decodeForestPkg(pkg: AreaPackage): Promise<{ forest: ForestData | null; forestError: string | null }> {
  const png = pkg.files['forest.png'];
  const js = pkg.files['forest.json'];
  if (!png || !js) return { forest: null, forestError: null };
  try {
    const [px, meta] = await Promise.all([pixels(png), js.text().then((t) => parseForestJson(JSON.parse(t)))]);
    return { forest: forestFromPixels(pkg.manifest, px.data, px.width, px.height, meta), forestError: null };
  } catch (e) {
    return { forest: null, forestError: e instanceof Error ? e.message : '森林データを読めませんでした' };
  }
}

// 格子の大きさの画像を作り、object URL を返す（作り直すたびに前の URL を捨てる）
function useGridOverlay(width: number, height: number, draw: ((out: Uint8ClampedArray) => void) | null): string | null {
  const [url, setUrl] = useState<string | null>(null);
  const canvas = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    if (!draw || !width || !height) {
      setUrl((prev) => { if (prev) URL.revokeObjectURL(prev); return null; });
      return;
    }
    const cv = canvas.current ?? (canvas.current = document.createElement('canvas'));
    cv.width = width;
    cv.height = height;
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    const img = ctx.createImageData(width, height);
    draw(img.data);
    ctx.putImageData(img, 0, 0);
    let revoked = false;
    cv.toBlob((blob) => {
      if (!blob || revoked) return;
      const u = URL.createObjectURL(blob);
      setUrl((prev) => { if (prev) URL.revokeObjectURL(prev); return u; });
    });
    return () => { revoked = true; };
  }, [width, height, draw]);
  return url;
}

const pct = (n: number) => `${n}%`;
const km2 = (v: number) => `${v < 1 ? v.toFixed(2) : v.toFixed(1)} km²`;
// Field Log の日付（2026/9/30・2026-09-30 など）→ YYYY-MM-DD
const ymd = (d: string | null | undefined): string | null => {
  const m = (d ?? '').match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  return m ? `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}` : null;
};
const fmtDate = (iso: string) => {
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

// 環境スポットの色（種類・生死）。ミズナラは金色の縁
const SPOT_COLORS: Record<SpotKindChoice, string> = { alive: '#2e7d32', snag: '#a1887f', fallen: '#5d4037', terrain: '#546e7a', other: '#9e9e9e' };

interface ProbeHead { species: string | null; note: string | null; vegetation: string | null; spots: string[] }

type PanelTab = 'search' | 'view' | 'record' | 'settings';
const PANEL_TABS: { id: PanelTab; label: string }[] = [
  { id: 'search', label: '探す' },
  { id: 'view', label: '見る' },
  { id: 'record', label: '記録' },
  { id: 'settings', label: '設定' },
];
const TAB_KEY = 'icarus:exploration-panel-tab';

const FOREST_ATTRIBUTION = '国土数値情報（国有林野）・北海道 森林計画・環境省 現存植生図2024 を加工';

function ClickProbe({ onClick, disabled }: { onClick: (lat: number, lng: number) => void; disabled?: boolean }) {
  // 進行方向モードでは Leaflet のタップ位置が回転でずれるので使わない（画面側で回転を戻して計算する）
  useMapEvents({ click: (e) => { if (!disabled) onClick(e.latlng.lat, e.latlng.lng); } });
  return null;
}

// 進行方向モード: 地図の大きさが変わったら知らせ、ドラッグを止めてズームは中心（=自分）を軸にする
function HeadingSync({ on, size, pos, mapRef }: { on: boolean; size: number; pos: [number, number] | null; mapRef: React.MutableRefObject<L.Map | null> }) {
  const map = useMap();
  useEffect(() => { mapRef.current = map; }, [map, mapRef]);
  useEffect(() => {
    map.invalidateSize({ pan: false });
    const setCenterZoom = (h: { disable: () => void; enable: () => void }, key: 'touchZoom' | 'scrollWheelZoom' | 'doubleClickZoom', v: boolean | 'center') => {
      h.disable();
      (map.options as Record<string, unknown>)[key] = v;
      h.enable();
    };
    if (on) {
      map.dragging.disable();
      map.boxZoom.disable();
      setCenterZoom(map.touchZoom, 'touchZoom', 'center');
      setCenterZoom(map.scrollWheelZoom, 'scrollWheelZoom', 'center');
      setCenterZoom(map.doubleClickZoom, 'doubleClickZoom', 'center');
      if (pos) map.setView(pos, map.getZoom(), { animate: false });
    } else {
      map.dragging.enable();
      map.boxZoom.enable();
      setCenterZoom(map.touchZoom, 'touchZoom', true);
      setCenterZoom(map.scrollWheelZoom, 'scrollWheelZoom', true);
      setCenterZoom(map.doubleClickZoom, 'doubleClickZoom', true);
    }
    // pos は追従（Follow）が動かす。ここではモードと大きさが変わった時だけ
  }, [map, on, size]); // eslint-disable-line react-hooks/exhaustive-deps
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
  // 地図をすっきりさせるため、Field Log は最初は出さない（見るタブで選ぶ）
  const [fieldLogFilter, setFieldLogFilter] = useState<FieldLogFilter>('none');
  const [base, setBase] = useState<Base>('offline');
  const [panelOpen, setPanelOpen] = useState(() => initialPanelOpen(typeof window === 'undefined' ? 1024 : window.innerWidth));

  const [probe, setProbe] = useState<{ lat: number; lng: number; lines: string[]; head?: ProbeHead } | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [watching, setWatching] = useState(false);
  const [follow, setFollow] = useState(true);
  const [pos, setPos] = useState<{ lat: number; lng: number; accuracy: number } | null>(null);
  const [gpsError, setGpsError] = useState<string | null>(null);
  const watchId = useRef<number | null>(null);

  // ---- 読み込み: 保存済みがあればそれを先に使い、電波とログインがあれば新しい版を確かめる ----
  const load = useCallback(async (pkg: AreaPackage) => {
    const [grid, roads, fr, hy] = await Promise.all([decodeGrid(pkg), decodeRoads(pkg), decodeForestPkg(pkg), decodeHydroPkg(pkg)]);
    setLoaded((prev) => {
      if (prev) URL.revokeObjectURL(prev.hillshadeUrl);
      return { pkg, grid, roads, roadIndex: indexRoads(roads), hillshadeUrl: URL.createObjectURL(pkg.files['hillshade.jpg']), ...fr, ...hy };
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
  // ---- 環境スポット（S3）: この木（地形・その他）がここにある、という現地の記録と、時間つきの観察 ----
  const spotBbox = useMemo<[number, number, number, number] | null>(() => (manifest ? [manifest.bounds.south, manifest.bounds.west, manifest.bounds.north, manifest.bounds.east] : null), [manifest]);
  const envSpots = useEnvironmentSpots(idToken, spotBbox);
  const [showSpots, setShowSpots] = useState(true);
  const [spotKinds, setSpotKinds] = useState<SpotKindChoice[]>(KIND_CHOICES.map((k) => k.id));
  const [spotSpecies, setSpotSpecies] = useState<string>('all');
  const [recordLoc, setRecordLoc] = useState<RecordLocation | null>(null);
  // 撮った写真から記録（山から戻ってから）: 写真の撮影時の GPS と日時を使う
  const [recordInit, setRecordInit] = useState<{ photos: PendingPhoto[]; observedAt: string | null } | null>(null);
  const [photoMsg, setPhotoMsg] = useState<string | null>(null);
  // 写真に位置が無い時: 地図をタップ（または座標を入力）して場所を決める間の状態
  const [placeWait, setPlaceWait] = useState<{ photos: PendingPhoto[]; observedAt: string | null } | null>(null);
  const [coordValue, setCoordValue] = useState('');
  const placeAt = (lat: number, lng: number) => {
    if (!placeWait) return;
    setRecordInit(placeWait);
    setRecordLoc({ lat, lng, source: 'map', accuracyM: null });
    setPlaceWait(null);
    setCoordValue('');
  };
  const placeByText = () => {
    const m = coordValue.match(/(-?\d+(?:\.\d+)?)\s*[,、\s]\s*(-?\d+(?:\.\d+)?)/);
    const lat = m ? Number(m[1]) : NaN;
    const lng = m ? Number(m[2]) : NaN;
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < 20 || lat > 46 || lng < 122 || lng > 154) {
      setPhotoMsg('座標は「43.05435, 140.78771」のように緯度, 経度で入力してください');
      return;
    }
    setPhotoMsg(null);
    placeAt(lat, lng);
  };
  const recordFromPhotos = async (files: FileList | null) => {
    setPhotoMsg(null);
    if (!files || files.length === 0) return;
    const list = Array.from(files).slice(0, 10);
    try {
      const meta = await readPhotoMeta(list[0]);
      const photos: PendingPhoto[] = [];
      for (const f of list) photos.push(await photoFromFile(f));
      if (meta.lat === null || meta.lng === null) {
        // iPhone は写真を渡す時に位置情報を外すことがある。写真と撮影日時は持ったまま、場所だけ地図か座標で指定してもらう
        setPlaceWait({ photos, observedAt: meta.takenAt });
        setPanelOpen(false);
        return;
      }
      setRecordInit({ photos, observedAt: meta.takenAt });
      setRecordLoc({ lat: meta.lat, lng: meta.lng, source: 'gps', accuracyM: meta.accuracyM, fromPhoto: true });
    } catch (e) {
      setPhotoMsg(e instanceof Error ? e.message : '写真を読めませんでした');
    }
  };
  const [selectedSpot, setSelectedSpot] = useState<string | null>(null);
  const kindOf = (m: SpotMarker): SpotKindChoice => (m.envType === 'tree' ? (m.lifeState as SpotKindChoice) : m.envType);
  const visibleSpots = useMemo(() => (showSpots ? envSpots.markers.filter((m) => spotKinds.includes(kindOf(m)) && (spotSpecies === 'all' || m.treeSpeciesId === spotSpecies)) : []), [showSpots, envSpots.markers, spotKinds, spotSpecies]);
  const selectedMarker = envSpots.markers.find((m) => m.key === selectedSpot) ?? null;
  const unsentSpots = envSpots.markers.filter((m) => m.origin === 'device' && m.status !== 'registered').length + envSpots.pendingObs.filter((o) => o.stage !== 'registered').length;
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

  // ---- S4a: 探す対象・対象ごとの探索実績・条件を重ねる（AND）・仮説（端末） ----
  const [targetId, setTargetId] = useState<string | null>(null);
  const [hyp, setHyp] = useState<HypothesisConditions>(NO_HYPOTHESIS_CONDITIONS);
  const [terrainUse, setTerrainUse] = useState({ candidate: false, dem: false });
  const [showTargetLayer, setShowTargetLayer] = useState(true);
  const [showMatch, setShowMatch] = useState(true);
  const [savedHyps, setSavedHyps] = useState<HypothesisSnapshot[]>([]);
  const [hypNote, setHypNote] = useState<string | null>(null);
  useEffect(() => { listHypotheses().then(setSavedHyps, () => undefined); }, []);
  const targetList = useMemo(() => envSpots.species.filter((sp) => sp.kind === 'target').sort((a, b) => a.sortOrder - b.sortOrder), [envSpots.species]);
  const treeList = useMemo(() => envSpots.species.filter((sp) => sp.kind === 'tree'), [envSpots.species]);
  const target = useMemo<TargetSpec | null>(() => {
    const t = targetList.find((x) => x.id === targetId);
    return t ? { speciesId: t.id, name: t.name, aliases: t.aliases } : null;
  }, [targetList, targetId]);
  // 対象を変えたら重ねた条件は白紙（舞茸の条件をほかの種にそのまま使わない）
  const chooseTarget = (id: string | null) => {
    setTargetId(id);
    setHyp(NO_HYPOTHESIS_CONDITIONS);
    setTerrainUse({ candidate: false, dem: false });
    setHypNote(null);
  };
  const trackEvidence = useMemo<TrackEvidence[]>(() => visibleHistory.map((e) => ({ segments: e.track!, exploredOn: e.exploredOn, targets: e.targets })), [visibleHistory]);
  const pointEvidence = useMemo<PointEvidence[]>(() => {
    const out: PointEvidence[] = [];
    for (const e of entries) if (Number.isFinite(e.lat) && Number.isFinite(e.lng) && inPeriod(ymd(e.date), period, new Date())) out.push({ lat: e.lat, lng: e.lng, name: e.foodName, result: 'found', date: ymd(e.date) });
    const nameOfSpecies = (id: string | null) => envSpots.species.find((sp) => sp.id === id)?.name ?? '';
    for (const mk of envSpots.markers) {
      for (const o of mk.remote?.observations ?? []) {
        if (o.status !== 'active' || (o.result !== 'found' && o.result !== 'not_found')) continue;
        if (!inPeriod(o.observedAt.slice(0, 10), period, new Date())) continue;
        out.push({ lat: mk.lat, lng: mk.lng, name: o.target || o.targetText || nameOfSpecies(o.targetSpeciesId), result: o.result, date: o.observedAt.slice(0, 10) });
      }
    }
    for (const o of envSpots.pendingObs) {
      if (o.stage === 'registered' || (o.input.result !== 'found' && o.input.result !== 'not_found')) continue;
      const mk = envSpots.markers.find((x) => (o.spotId && x.spotId === o.spotId) || (o.pendingSpotId && x.pendingId === o.pendingSpotId));
      if (!mk || !inPeriod(o.input.observedAt.slice(0, 10), period, new Date())) continue;
      out.push({ lat: mk.lat, lng: mk.lng, name: o.input.targetSpeciesId ? nameOfSpecies(o.input.targetSpeciesId) : o.input.targetText ?? '', result: o.input.result, date: o.input.observedAt.slice(0, 10) });
    }
    return out;
  }, [entries, envSpots.markers, envSpots.pendingObs, envSpots.species, period]);
  const te = useMemo(() => (manifest ? buildTargetExploration(manifest, target, trackEvidence, pointEvidence, coverageWidth, DEFAULT_POINT_RADIUS_M) : null), [manifest, target, trackEvidence, pointEvidence, coverageWidth]);
  const stateAreas = useMemo(() => (manifest && te && loaded ? stateAreasKm2(manifest, te, (i) => loaded.grid.terrain[i * 4 + 3] > 0) : null), [manifest, te, loaded]);
  const treePoints = useMemo(() => envSpots.markers.map((mk) => ({ lat: mk.lat, lng: mk.lng, treeSpeciesId: mk.treeSpeciesId })), [envSpots.markers]);
  const treeCounts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const mk of envSpots.markers) if (mk.treeSpeciesId) c[mk.treeSpeciesId] = (c[mk.treeSpeciesId] ?? 0) + 1;
    return c;
  }, [envSpots.markers]);

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

  // ---- 森林（S1）: レイヤーはすべて独立（ミズナラ 1〜3 位を 1 色に潰さない）。既定はすべて OFF ----
  const [forestLayers, setForestLayers] = useState<ForestLayers>(NO_FOREST_LAYERS);
  const forest = loaded?.forest ?? null;
  const communities = useMemo(() => (forest ? mizunaraCommunities(forest) : []), [forest]);
  const forestHa = useMemo(() => {
    if (!forest || !manifest) return null;
    const px = manifest.grid.pxM;
    const byStand = (f: (st: ForestStand) => boolean) => forestAreaHa(forest, px, (st) => !!st && f(st));
    const veg: Record<string, number> = {};
    for (const c of communities) veg[c] = forestAreaHa(forest, px, (_, v) => v?.name === c);
    return {
      mz1: byStand((st) => st.mizunaraRank === 1), mz2: byStand((st) => st.mizunaraRank === 2), mz3: byStand((st) => st.mizunaraRank === 3),
      kokuyuNoMizunara: byStand((st) => st.owner === 'k' && st.mizunaraRank === 0 && st.cls !== FOREST_CLASS.noRegister),
      broadleafUnknown: byStand((st) => st.cls === FOREST_CLASS.broadleafUnknown),
      larch: byStand((st) => st.cls === FOREST_CLASS.larch), todo: byStand((st) => st.cls === FOREST_CLASS.todo),
      veg,
    };
  }, [forest, manifest, communities]);
  const [forestUrl, setForestUrl] = useState<string | null>(null);
  const forestCanvas = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    if (!forest || !anyForestLayer(forestLayers)) {
      setForestUrl((prev) => { if (prev) URL.revokeObjectURL(prev); return null; });
      return;
    }
    const canvas = forestCanvas.current ?? (forestCanvas.current = document.createElement('canvas'));
    canvas.width = forest.width;
    canvas.height = forest.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const img = ctx.createImageData(forest.width, forest.height);
    renderForest(forest, forestLayers, img.data);
    ctx.putImageData(img, 0, 0);
    let revoked = false;
    canvas.toBlob((blob) => {
      if (!blob || revoked) return;
      const url = URL.createObjectURL(blob);
      setForestUrl((prev) => { if (prev) URL.revokeObjectURL(prev); return url; });
    });
    return () => { revoked = true; };
  }, [forest, forestLayers]);
  // ---- DEM 由来の地形（S2）: 条件どうしは AND、1 つの条件の中は OR。既定は条件なし ----
  const [terrainCond, setTerrainCond] = useState<TerrainConditions>(NO_TERRAIN_CONDITIONS);
  const [showStreams, setShowStreams] = useState(false);
  const hydro = loaded?.hydro ?? null;
  const [hydroUrl, setHydroUrl] = useState<string | null>(null);
  const [terrainMatchKm2, setTerrainMatchKm2] = useState<number | null>(null);
  const hydroCanvas = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    if (!hydro || !manifest || (!anyTerrainCondition(terrainCond) && !showStreams)) {
      setHydroUrl((prev) => { if (prev) URL.revokeObjectURL(prev); return null; });
      setTerrainMatchKm2(null);
      return;
    }
    const canvas = hydroCanvas.current ?? (hydroCanvas.current = document.createElement('canvas'));
    canvas.width = hydro.width;
    canvas.height = hydro.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const img = ctx.createImageData(hydro.width, hydro.height);
    const { matchCells } = renderHydro(manifest, hydro, terrainCond, showStreams, img.data);
    setTerrainMatchKm2(anyTerrainCondition(terrainCond) ? (matchCells * manifest.grid.pxM * manifest.grid.pxM) / 1e6 : null);
    ctx.putImageData(img, 0, 0);
    let revoked = false;
    canvas.toBlob((blob) => {
      if (!blob || revoked) return;
      const url = URL.createObjectURL(blob);
      setHydroUrl((prev) => { if (prev) URL.revokeObjectURL(prev); return url; });
    });
    return () => { revoked = true; };
  }, [hydro, manifest, terrainCond, showStreams]);
  const toggleIn = <T,>(list: T[], v: T, on: boolean) => (on ? [...list, v] : list.filter((x) => x !== v));

  // ---- S4a: 条件を重ねる（グループ内 OR・グループ間 AND）。地形は下の探索条件・地形の条件をそのまま使う ----
  const hypEffective = useMemo<HypothesisConditions>(() => ({
    ...hyp,
    terrain: terrainUse.candidate || (terrainUse.dem && anyTerrainCondition(terrainCond))
      ? { candidate: terrainUse.candidate ? conditions : null, dem: terrainUse.dem && anyTerrainCondition(terrainCond) ? terrainCond : null }
      : null,
  }), [hyp, terrainUse, conditions, terrainCond]);
  const matchCtx = useMemo(() => (manifest && loaded ? { m: manifest, grid: loaded.grid, forest, hydro, te, trees: treePoints, today: new Date() } : null), [manifest, loaded, forest, hydro, te, treePoints]);
  const compiledHyp = useMemo(() => (matchCtx ? compileHypothesis(matchCtx, hypEffective) : null), [matchCtx, hypEffective]);
  const matchResult = useMemo(() => (matchCtx && compiledHyp && compiledHyp.groups.length ? computeMatch(matchCtx, compiledHyp) : null), [matchCtx, compiledHyp]);
  const forestYears = useMemo(() => ({
    forestPlan: forest ? [forest.sources.kokuyu?.year && `国有林 ${forest.sources.kokuyu.year}`, forest.sources.minyu?.year && `民有林 ${forest.sources.minyu.year}`].filter(Boolean).join('・') || null : null,
    vegetation: forest?.sources.veg?.years ? forest.sources.veg.years.join('〜') : null,
  }), [forest]);
  const stateLabelFor = useCallback((st: ExplorationState) => (target ? STATE_LABEL[st] : STATE_LABEL_NO_TARGET[st] ?? STATE_LABEL[st]), [target]);
  const conditionText = useMemo(() => describeConditions(hypEffective, target, forestYears, stateLabelFor), [hypEffective, target, forestYears, stateLabelFor]);
  const drawTarget = useMemo(() => (te && showTargetLayer && targetId ? (out: Uint8ClampedArray) => renderTargetExploration(te, out) : null), [te, showTargetLayer, targetId]);
  const targetUrl = useGridOverlay(manifest?.grid.width ?? 0, manifest?.grid.height ?? 0, drawTarget);
  const drawMatch = useMemo(() => (matchResult && showMatch ? (out: Uint8ClampedArray) => renderMatch(matchResult.mask, out) : null), [matchResult, showMatch]);
  const matchUrl = useGridOverlay(manifest?.grid.width ?? 0, manifest?.grid.height ?? 0, drawMatch);

  const saveCurrentHypothesis = async (name: string) => {
    if (!manifest || !matchResult || !te) throw new Error('条件を 1 つ以上選んでください');
    const snap = buildSnapshot({
      id: crypto.randomUUID(), name, now: new Date(), target: target ? { speciesId: target.speciesId, name: target.name } : null,
      m: manifest, forest, hydroPresent: !!hydro,
      evidence: {
        period, purposeFilter, tracks: te.counts.tracks, foundTracks: te.counts.foundTracks, notFoundTracks: te.counts.notFoundTracks,
        foundPoints: te.counts.foundPoints, notFoundPoints: te.counts.notFoundPoints, latestExploredOn: te.counts.latest,
        confirmedTrees: hypEffective.confirmedTrees ? treeCounts[hypEffective.confirmedTrees.treeSpeciesId] ?? 0 : 0,
      },
      coverageWidthM: coverageWidth, pointRadiusM: DEFAULT_POINT_RADIUS_M,
      conditions: hypEffective, conditionText, result: matchResult, appBuild: APP_BUILD,
    });
    await saveHypothesis(snap);
    setSavedHyps(await listHypotheses());
  };
  const loadHypothesis = (h: HypothesisSnapshot) => {
    setTargetId(h.target?.speciesId ?? null);
    const c = h.conditions;
    setHyp({ ...c, terrain: null });
    if (c.terrain?.candidate) { setConditions(c.terrain.candidate); setPresetId(matchPreset(c.terrain.candidate)); }
    if (c.terrain?.dem) setTerrainCond(c.terrain.dem);
    setTerrainUse({ candidate: !!c.terrain?.candidate, dem: !!c.terrain?.dem });
    if ((COVERAGE_WIDTHS_M as readonly number[]).includes(h.params.coverageWidthM)) setCoverageWidth(h.params.coverageWidthM as CoverageWidth);
    setShowMatch(true);
    const notes: string[] = [];
    if (h.data.terrainVersion !== manifest?.version) notes.push(`保存時の地形データ（${h.data.terrainVersion}）と今の版（${manifest?.version}）が違うため、面積が保存時と変わることがあります`);
    if (h.params.pointRadiusM !== DEFAULT_POINT_RADIUS_M) notes.push(`保存時の点の範囲は ${h.params.pointRadiusM}m（今は ${DEFAULT_POINT_RADIUS_M}m）`);
    setHypNote(notes.length ? notes.join('。') : null);
  };

  const toggleForest = (k: Exclude<keyof ForestLayers, 'vegMizunara'>) => (e: React.ChangeEvent<HTMLInputElement>) => setForestLayers((l) => ({ ...l, [k]: e.target.checked }));
  const toggleCommunity = (name: string) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForestLayers((l) => ({ ...l, vegMizunara: e.target.checked ? [...l.vegMizunara, name] : l.vegMizunara.filter((n) => n !== name) }));

  // ---- 等高線（既定 OFF。ON にした時だけ読み込む。2026-09-29 より前の版には無い） ----
  const [showContours, setShowContours] = useState(false);
  const [contours, setContours] = useState<{ version: string; data: Contours } | null>(null);
  const [contourError, setContourError] = useState<string | null>(null);
  const contourBlob = loaded?.pkg.files['contours.json'] ?? null;
  const contourVersion = manifest?.version ?? null;
  useEffect(() => {
    if (!showContours || !contourBlob || !contourVersion || contours?.version === contourVersion) return;
    let cancelled = false;
    setContourError(null);
    decodeContours(contourBlob).then(
      (data) => !cancelled && setContours({ version: contourVersion, data }),
      (e) => !cancelled && setContourError(e instanceof Error ? e.message : '等高線を読めませんでした'),
    );
    return () => {
      cancelled = true;
    };
  }, [showContours, contourBlob, contourVersion, contours?.version]);

  // 大分類 → 種名（表記ゆれは検索の時だけそろえる。speciesFilter.ts）
  const [species, setSpecies] = useState<string>(ALL_SPECIES);
  const categoryPoints = useMemo(() => {
    if (fieldLogFilter === 'none') return [];
    return entries.filter((e) => fieldLogFilter === 'all' || e.largeCategory === fieldLogFilter);
  }, [entries, fieldLogFilter]);
  const species_ = useMemo(() => speciesOptions(categoryPoints), [categoryPoints]);
  const activeSpecies = species === ALL_SPECIES || species_.some((o) => o.key === species) ? species : ALL_SPECIES;
  const logPoints = useMemo(() => filterBySpecies(categoryPoints, activeSpecies), [categoryPoints, activeSpecies]);

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
    if (loaded.hydro) lines.push(...describeHydro(manifest, loaded.hydro, i));
    // S4a: 重ねた条件のグループごとの ✓／✗（どこで外れたかが分かるように）
    if (compiledHyp && compiledHyp.groups.length) {
      const r = compiledHyp.test(i);
      const all = compiledHyp.groups.every((g) => r[g] === true);
      lines.unshift(`重ねた条件 ${all ? 'すべて満たす' : '満たさない'}：${compiledHyp.groups.map((g) => `${GROUP_LABEL[g]}${r[g] ? '✓' : '✗'}`).join(' ')}`);
    }
    if (targetId) lines.push(...describeTargetAt(target, trackEvidence, pointEvidence, coverageWidth, DEFAULT_POINT_RADIUS_M, lat, lng, distanceToTrackM));
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
  }, [loaded, manifest, cc, coverage, showHistory, visibleHistory, coverageWidth, compiledHyp, targetId, target, trackEvidence, pointEvidence]);

  // 記録時の地形の値（terrain_json）。端末の地形パッケージから計算し、version とデータの年を付ける
  const terrainAt = useCallback((lat: number, lng: number): Record<string, unknown> | null => {
    if (!loaded || !manifest) return null;
    const { x, y } = latLngToGrid(manifest, lat, lng);
    const i = cellIndex(loaded.grid, x, y);
    if (i === null) return { terrainVersion: manifest.version, outside: true };
    const v = cellValues(manifest, loaded.grid, i);
    const snap: Record<string, unknown> = {
      terrainVersion: manifest.version, slopeDeg: Math.round(v.slopeDeg), sun: Math.round(v.sun * 100) / 100,
      ridgeM: v.ridgeM === null ? null : Math.round(v.ridgeM), roadM: v.roadM === null ? null : Math.round(v.roadM),
    };
    const h = loaded.hydro;
    if (h) {
      const d = hydroAspectDeg(h.aspect[i]);
      snap.aspectDeg = d === null ? null : Math.round(d);
      snap.aspect = d === null ? '平坦' : DIRECTION_LABEL[hydroDirectionOf(d)];
      snap.landform = HYDRO_LANDFORMS.find((l) => l.id === h.landform[i])?.label ?? null;
      snap.streamM = h.streamDist[i] === 255 ? null : Math.round(h.streamDist[i] * manifest.grid.pxM);
      snap.stream = h.streamDist[i] === 255 ? '沢から約1.2km以上' : `沢から約${Math.round((h.streamDist[i] * manifest.grid.pxM) / 10) * 10}m`;
      snap.twi = Math.round(hydroTwiValue(manifest, h.twiLevel[i]) * 10) / 10;
    }
    const f = loaded.forest;
    if (f) {
      const st = f.stand[i] ? f.stands[f.stand[i] - 1] : null;
      const vg = f.veg[i] ? f.vegs[f.veg[i] - 1] : null;
      snap.forestStand = st ? { owner: st.owner, year: st.year, species: st.species.map(([n]) => n), mizunaraRank: st.mizunaraRank } : null;
      snap.vegetation = vg ? { name: vg.name, year: vg.year } : null;
    }
    return snap;
  }, [loaded, manifest]);

  // 地点情報の見出し: 樹種（林分の 1〜3 位）・植生・近くの環境スポットを一番上に大きく
  const headOf = useCallback((lat: number, lng: number): ProbeHead | undefined => {
    if (!loaded || !manifest) return undefined;
    const { x, y } = latLngToGrid(manifest, lat, lng);
    const i = cellIndex(loaded.grid, x, y);
    const fh = loaded.forest && i !== null ? forestHeadline(loaded.forest, i) : null;
    const ky = 111320, kx = 111320 * Math.cos((lat * Math.PI) / 180);
    const near = envSpots.markers
      .map((m) => ({ m, d: Math.hypot((m.lat - lat) * ky, (m.lng - lng) * kx) }))
      .filter((x_) => x_.d <= 50)
      .sort((a, b) => a.d - b.d)
      .slice(0, 3)
      .map(({ m, d }) => `${m.label}${m.envType === 'tree' ? `（${({ alive: '生木', snag: '立枯れ', fallen: '倒木', na: '' } as const)[m.lifeState]}）` : ''} 約${Math.max(1, Math.round(d))}m`);
    if (!fh?.species && !fh?.vegetation && near.length === 0) return undefined;
    return { species: fh?.species ?? null, note: fh?.note ?? null, vegetation: fh?.vegetation ?? null, spots: near };
  }, [loaded, manifest, envSpots.markers]);
  const onMapClick = useCallback((lat: number, lng: number) => {
    if (placeWait) { placeAt(lat, lng); return; } // 写真の場所を指定中
    setProbe({ lat, lng, lines: describePoint(lat, lng), head: headOf(lat, lng) });
  }, [describePoint, headOf, placeWait]); // eslint-disable-line react-hooks/exhaustive-deps
  // 条件を変えたら、開いている地点情報も今の条件で出し直す
  useEffect(() => {
    setProbe((p) => (p ? { ...p, lines: describePoint(p.lat, p.lng), head: headOf(p.lat, p.lng) } : p));
  }, [describePoint, headOf]);

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
  // ---- パネルのタブ（探す／見る／記録／設定）と「表示中」の要約 ----
  const [tab, setTab] = useState<PanelTab>(() => {
    try {
      const v = localStorage.getItem(TAB_KEY);
      return PANEL_TABS.some((t) => t.id === v) ? (v as PanelTab) : 'search';
    } catch {
      return 'search';
    }
  });
  const chooseTab = (t: PanelTab) => {
    setTab(t);
    try { localStorage.setItem(TAB_KEY, t); } catch { /* 保存できなくても使える */ }
  };
  const activeSummary = useMemo(() => {
    const out: string[] = [];
    const abc = (['A', 'B', 'C'] as const).filter((k) => show[k]).join('');
    if (abc) out.push(`候補 ${abc}`);
    if (hydro && anyTerrainCondition(terrainCond)) out.push(`地形 ${summarizeTerrain(terrainCond)}${terrainMatchKm2 !== null ? `（${terrainMatchKm2.toFixed(1)}km²）` : ''}`);
    if (target) out.push(`対象 ${target.name}`);
    if (matchResult && showMatch) out.push(`重ねた条件 ${matchResult.matchKm2 < 1 ? matchResult.matchKm2.toFixed(2) : matchResult.matchKm2.toFixed(1)}km²`);
    if (anyForestLayer(forestLayers)) out.push('森林');
    if (showContours) out.push('等高線');
    if (showStreams) out.push('沢');
    if (show.ridge) out.push('尾根線');
    if (show.sun) out.push('日射');
    if (showHistory && visibleHistory.length) out.push('探索履歴');
    if (fieldLogFilter !== 'none') out.push('Field Log');
    if (showSpots && visibleSpots.length) out.push('環境スポット');
    return out;
  }, [target, matchResult, showMatch, show, hydro, terrainCond, terrainMatchKm2, forestLayers, showContours, showStreams, showHistory, visibleHistory.length, fieldLogFilter, showSpots, visibleSpots.length]);
  // 地図を最小に: 陰影・道・現在地・探索履歴・環境スポットだけ残す
  const minimizeMap = () => {
    setShow((sh) => ({ ...sh, A: false, B: false, C: false, ridge: false, sun: false }));
    setTerrainCond(NO_TERRAIN_CONDITIONS);
    setForestLayers(NO_FOREST_LAYERS);
    setShowContours(false);
    setShowStreams(false);
    setFieldLogFilter('none');
    setShowMatch(false);
    setShowTargetLayer(false);
  };

  // ---- 進行方向モード: iPhone を向けている方向を画面の上にする（地図を回す）。方向センサーは押した時だけ許可を求める ----
  const [headingMode, setHeadingMode] = useState(false);
  const [headingAsk, setHeadingAsk] = useState(false);
  const [headingMsg, setHeadingMsg] = useState<string | null>(null);
  const sensorOk = useRef(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const rotorRef = useRef<HTMLDivElement | null>(null);
  const labelRef = useRef<HTMLDivElement | null>(null);
  const northRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const headingRef = useRef<number | null>(null);
  const [rootSize, setRootSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = rootRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => setRootSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, [loaded]);
  // 自分の位置は画面の少し下（前方を広く見る）
  const anchor = useMemo(() => ({ x: rootSize.w / 2, y: rootSize.h * 0.62 }), [rootSize]);
  const rotor = useMemo(() => rotorSize(rootSize.w, rootSize.h, anchor), [rootSize, anchor]);
  const applyHeading = useCallback((deg: number) => {
    if (rotorRef.current) rotorRef.current.style.transform = `rotate(${-deg}deg)`;
    if (northRef.current) northRef.current.style.transform = `rotate(${-deg}deg)`;
    if (labelRef.current) labelRef.current.textContent = headingLabel(deg);
  }, []);
  useEffect(() => {
    if (!headingMode) return;
    let raf = 0;
    let got = false;
    const onOri = (e: DeviceOrientationEvent) => {
      const angle = (typeof screen !== 'undefined' && screen.orientation ? screen.orientation.angle : 0) || 0;
      const h = headingFromEvent(e as DeviceOrientationEvent & { webkitCompassHeading?: number }, angle);
      if (h === null) return;
      got = true;
      headingRef.current = smoothAngle(headingRef.current, h);
      if (!raf) raf = requestAnimationFrame(() => { raf = 0; if (headingRef.current !== null) applyHeading(headingRef.current); });
    };
    const absEvent = 'ondeviceorientationabsolute' in window ? 'deviceorientationabsolute' : 'deviceorientation';
    window.addEventListener(absEvent, onOri as EventListener);
    const t = setTimeout(() => { if (!got) setHeadingMsg('方向センサーの値が届きません。iPhone を水平に持って 8 の字に動かすと直ることがあります'); }, 4000);
    return () => { window.removeEventListener(absEvent, onOri as EventListener); cancelAnimationFrame(raf); clearTimeout(t); };
  }, [headingMode, applyHeading]);
  const enterHeading = async () => {
    setHeadingAsk(false);
    const r = await requestOrientationPermission(); // 押した操作の中で呼ぶ（iOS の条件）
    if (r !== 'granted') {
      setHeadingMsg(r === 'unsupported' ? 'この端末では方向センサーを使えません' : '方向センサーが許可されていません（アプリを開き直すと、もう一度たずねます）');
      return;
    }
    sensorOk.current = true;
    setHeadingMsg(null);
    headingRef.current = null;
    if (watchId.current === null) { startGps(); rememberGps(true); }
    setFollow(true);
    setHeadingMode(true);
  };
  const exitHeading = () => {
    setHeadingMode(false);
    setHeadingMsg(null);
    headingRef.current = null;
    if (rotorRef.current) rotorRef.current.style.transform = '';
  };
  const onHeadingButton = () => {
    if (headingMode) exitHeading();
    else if (sensorOk.current) void enterHeading();
    else setHeadingAsk(true);
  };
  // 回っている地図のタップ: 画面の点 → 回転を戻す → 地図の座標
  const onRootClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!headingMode || !rotorRef.current || !rootRef.current || !mapRef.current) return;
    if (!rotorRef.current.contains(e.target as Node)) return;
    const r = rootRef.current.getBoundingClientRect();
    const pt = screenToMapPoint({ x: e.clientX - r.left, y: e.clientY - r.top }, anchor, rotor, headingRef.current ?? 0);
    const ll = mapRef.current.containerPointToLatLng([pt.x, pt.y]);
    onMapClick(ll.lat, ll.lng);
  };

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
    <div className={styles.root} ref={rootRef} onClick={onRootClick}>
      <div
        ref={rotorRef}
        className={`${styles.rotor} ${headingMode && rotor > 0 ? styles.rotating : ''}`}
        style={headingMode && rotor > 0 ? { width: rotor, height: rotor, left: anchor.x - rotor / 2, top: anchor.y - rotor / 2 } : undefined}
      >
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
        {forestUrl && <ImageOverlay url={forestUrl} bounds={bounds} opacity={1} zIndex={4} attribution={FOREST_ATTRIBUTION} />}
        {overlayUrl && <ImageOverlay url={overlayUrl} bounds={bounds} opacity={1} zIndex={5} />}
        {hydroUrl && <ImageOverlay url={hydroUrl} bounds={bounds} opacity={1} zIndex={6} />}
        {targetUrl && <ImageOverlay url={targetUrl} bounds={bounds} opacity={1} zIndex={7} />}
        {matchUrl && <ImageOverlay url={matchUrl} bounds={bounds} opacity={1} zIndex={8} />}
        {showContours && contours && contours.version === manifest.version && <ContourLayer contours={contours.data} />}
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
        {visibleSpots.map((m) => (
          <CircleMarker
            key={m.key}
            center={[m.lat, m.lng]}
            radius={m.treeSpeciesId === 'tree-mizunara' ? 8 : 7}
            pathOptions={{
              color: m.treeSpeciesId === 'tree-mizunara' ? '#f9a825' : '#fff', weight: m.treeSpeciesId === 'tree-mizunara' ? 3 : 1.5,
              dashArray: m.origin === 'device' && m.status !== 'registered' ? '3 3' : undefined,
              fillColor: SPOT_COLORS[kindOf(m)], fillOpacity: 0.95,
            }}
            eventHandlers={{ click: (e) => { L.DomEvent.stopPropagation(e); setSelectedSpot(m.key); } }}
          />
        ))}
        {logPoints.map((e) => (
          <CircleMarker key={e.id} center={[e.lat, e.lng]} radius={6} pathOptions={{ color: '#fff', weight: 1.5, fillColor: '#2b8a3e', fillOpacity: speciesKey(e.foodName).uncertain ? 0.4 : 0.9 }}>
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
        <ClickProbe onClick={onMapClick} disabled={headingMode} />
        <HeadingSync on={headingMode} size={headingMode ? rotor : 0} pos={pos ? [pos.lat, pos.lng] : null} mapRef={mapRef} />
      </MapContainer>
      </div>
      {headingMode && (
        <>
          <div ref={labelRef} className={styles.headingLabel} aria-live="off">向きを取得中…</div>
          <div ref={northRef} className={styles.northMark} aria-label="北">▲<span>N</span></div>
          <div className={styles.headingZoom}>
            <button className={styles.btn} onClick={() => mapRef.current?.zoomIn()} aria-label="拡大">＋</button>
            <button className={styles.btn} onClick={() => mapRef.current?.zoomOut()} aria-label="縮小">－</button>
          </div>
          <div className={styles.headingAttribution}>国土地理院 | © OpenStreetMap contributors{forestUrl ? ` | ${FOREST_ATTRIBUTION}` : ''}</div>
        </>
      )}
      {placeWait && !recordLoc && (
        <div className={styles.placeBanner} role="dialog" aria-label="写真の場所を指定">
          <b>写真に位置情報がありません</b>
          <p className={styles.sub}>地図で木の場所をタップするか、座標を入力してください（写真{placeWait.photos.length}枚{placeWait.observedAt ? `・撮影 ${fmtDate(placeWait.observedAt)}` : ''}は保ったまま）</p>
          <p className={styles.sub}>{NO_GPS_HINT}</p>
          <div className={styles.row}>
            <input className={styles.coordInput} value={coordValue} onChange={(e) => setCoordValue(e.target.value)} placeholder="43.05435, 140.78771" inputMode="decimal" />
            <button className={styles.btn} onClick={placeByText}>この座標</button>
            <button className={styles.btn} onClick={() => { setPlaceWait(null); setPhotoMsg(null); }}>やめる</button>
          </div>
          {photoMsg && <p className={styles.warn}>{photoMsg}</p>}
        </div>
      )}
      {recordLoc && (
        <EnvironmentSpotRecordSheet
          location={recordLoc}
          species={envSpots.species}
          terrainAt={terrainAt}
          onSave={async (b, ph) => { await envSpots.record(b, ph); }}
          onClose={() => { setRecordLoc(null); setRecordInit(null); }}
          initialPhotos={recordInit?.photos}
          observedAt={recordInit?.observedAt ?? null}
        />
      )}
      {selectedMarker && !recordLoc && (
        <EnvironmentSpotDetailSheet
          marker={selectedMarker}
          species={envSpots.species}
          pendingObs={envSpots.pendingObs}
          idToken={idToken}
          onObserve={async (t, input) => { await envSpots.observe(t, input); }}
          onClose={() => setSelectedSpot(null)}
          isAdmin={staffMe?.role === 'admin'}
          here={pos}
          onChanged={() => void envSpots.refreshRemote()}
        />
      )}
      {/* 地図の上のボタンは 1 か所にまとめる（現在地・進行方向・記録） */}
      {/* 地点情報・記録・詳細を開いている間はボタンを隠す（スマホで地点情報の見出しと閉じるボタンに重なるため） */}
      {!probe && !recordLoc && !selectedMarker && (
      <div className={styles.toolbar}>
        <button className={`${styles.tool} ${watching ? styles.toolOn : ''}`} onClick={toggleGps} aria-pressed={watching}>{watching ? '現在地 ON' : '現在地'}</button>
        {(pos || headingMode) && (
          <button className={`${styles.tool} ${headingMode ? styles.toolOn : ''}`} onClick={onHeadingButton} aria-pressed={headingMode}>{headingMode ? '北を上に' : '進行方向'}</button>
        )}
        {pos && !headingMode && !recordLoc && (
          <button className={styles.tool} onClick={() => setRecordLoc({ lat: pos.lat, lng: pos.lng, source: 'gps', accuracyM: pos.accuracy })}>＋記録</button>
        )}
      </div>
      )}
      {headingAsk && (
        <div className={styles.headingAsk} role="dialog" aria-label="進行方向モード">
          <p>地図を向いている方向に合わせるため、方向センサーを使用します。</p>
          <div className={styles.row}>
            <button className={`${styles.btn} ${styles.primary}`} onClick={() => void enterHeading()}>使う</button>
            <button className={styles.btn} onClick={() => setHeadingAsk(false)}>やめる</button>
          </div>
        </div>
      )}
      {headingMsg && <div className={styles.toast} role="status" onClick={() => setHeadingMsg(null)}>{headingMsg}</div>}

      <section className={`${styles.panel} ${panelOpen ? '' : styles.collapsed}`} aria-label="地形探索の条件と操作">
        <div className={styles.panelHead}>
          <strong>地形探索</strong>
          <span className={styles.areaName}>{manifest.name}</span>
          <button className={styles.btn} onClick={() => setPanelOpen((v) => !v)} aria-expanded={panelOpen}>{panelOpen ? '閉じる' : '条件・操作'}</button>
        </div>
        {activeSummary.length > 0 && (
          <p className={styles.condSummary}>
            表示中：{activeSummary.join(' / ')}
            <button className={styles.linkBtn} onClick={minimizeMap}>最小に</button>
          </p>
        )}
        {panelOpen && (
          <div className={styles.tabs} role="tablist">
            {PANEL_TABS.map((t) => (
              <button key={t.id} role="tab" aria-selected={tab === t.id} className={`${styles.tab} ${tab === t.id ? styles.tabOn : ''}`} onClick={() => chooseTab(t.id)}>{t.label}</button>
            ))}
          </div>
        )}

        {panelOpen && (
          <div className={styles.panelBody}>
            {tab === 'search' && (
              <>
            <HypothesisPanel
              targets={targetList}
              targetId={targetId}
              onTarget={chooseTarget}
              hyp={hyp}
              onHyp={setHyp}
              terrainUse={terrainUse}
              onTerrainUse={setTerrainUse}
              demAvailable={!!hydro}
              demSummary={anyTerrainCondition(terrainCond) ? summarizeTerrain(terrainCond) : null}
              candidateSummary={`傾斜 ${conditions.slopeMinDeg}° 以上・日射 上位 ${conditions.sunTopPct}%・尾根から約 ${Math.round(conditions.ridgeMaxM)}m`}
              communities={communities}
              forestAvailable={!!forest}
              forestYears={forestYears}
              trees={treeList}
              treeCounts={treeCounts}
              stateAreas={targetId ? stateAreas : null}
              showTargetLayer={showTargetLayer}
              onShowTargetLayer={setShowTargetLayer}
              showMatch={showMatch}
              onShowMatch={setShowMatch}
              conditionText={conditionText}
              match={matchResult}
              missing={(compiledHyp?.missing ?? []).map((g) => GROUP_LABEL[g])}
              saved={savedHyps}
              suggestedName={suggestName(target, conditionText)}
              onSave={saveCurrentHypothesis}
              onLoad={loadHypothesis}
              onDelete={async (id) => { await deleteHypothesis(id); setSavedHyps(await listHypotheses()); }}
              terrainVersion={manifest.version}
              pointRadiusM={DEFAULT_POINT_RADIUS_M}
            />
            {hypNote && <p className={styles.warn}>{hypNote}</p>}
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

            <details className={styles.details} open={anyTerrainCondition(terrainCond)}>
              <summary className={styles.h}>地形の条件{anyTerrainCondition(terrainCond) ? `：${summarizeTerrain(terrainCond)}` : ''}</summary>
            {!hydro && !loaded.hydroError && <p className={styles.sub}>この版の地形データには方位・沢がありません（新しい版を「更新して保存」すると使えます）</p>}
            {loaded.hydroError && <p className={styles.sub}>{loaded.hydroError}</p>}
            {hydro && (
              <>
                <p className={styles.sub}>選んだ条件をすべて満たす範囲を<span style={{ color: `rgb(${TERRAIN_MATCH_COLOR.slice(0, 3).join(',')})`, fontWeight: 700 }}> 点 </span>で表示（同じ項目の中はどれか、項目どうしは全部）</p>
                <p className={styles.sub}>斜面の向き</p>
                <div className={styles.chips}>
                  {DIRECTIONS.map((d: Direction) => (
                    <label key={d} className={styles.chip}>
                      <input type="checkbox" checked={terrainCond.directions.includes(d)} onChange={(e) => setTerrainCond((c) => ({ ...c, directions: toggleIn(c.directions, d, e.target.checked) }))} />
                      {DIRECTION_LABEL[d]}
                    </label>
                  ))}
                </div>
                <p className={styles.sub}>斜面の位置</p>
                <div className={styles.chips}>
                  {LANDFORMS.map((l) => (
                    <label key={l.id} className={styles.chip}>
                      <input type="checkbox" checked={terrainCond.landforms.includes(l.id)} onChange={(e) => setTerrainCond((c) => ({ ...c, landforms: toggleIn(c.landforms, l.id as number, e.target.checked) }))} />
                      {l.label}
                    </label>
                  ))}
                </div>
                <p className={styles.sub}>湿潤度（水の集まりやすさ）</p>
                <div className={styles.chips}>
                  {(['low', 'mid', 'high'] as Wetness[]).map((w) => (
                    <label key={w} className={styles.chip}>
                      <input type="checkbox" checked={terrainCond.wetness.includes(w)} onChange={(e) => setTerrainCond((c) => ({ ...c, wetness: toggleIn(c.wetness, w, e.target.checked) }))} />
                      {WETNESS_LABEL[w]}
                    </label>
                  ))}
                </div>
                <label className={styles.check}>
                  沢から
                  <select className={styles.selectSmall} value={terrainCond.streamWithinM ?? ''} onChange={(e) => setTerrainCond((c) => ({ ...c, streamWithinM: e.target.value ? Number(e.target.value) : null }))} aria-label="沢から○m以内">
                    <option value="">指定なし</option>
                    {[50, 100, 200, 300].map((v) => <option key={v} value={v}>{v}m 以内</option>)}
                  </select>
                  <select className={styles.selectSmall} value={terrainCond.streamBeyondM ?? ''} onChange={(e) => setTerrainCond((c) => ({ ...c, streamBeyondM: e.target.value ? Number(e.target.value) : null }))} aria-label="沢から○m以上">
                    <option value="">指定なし</option>
                    {[100, 200, 300, 500].map((v) => <option key={v} value={v}>{v}m 以上</option>)}
                  </select>
                </label>
                {terrainMatchKm2 !== null && <p className={styles.sub}>条件をすべて満たす範囲 {terrainMatchKm2.toFixed(1)} km²</p>}
                {anyTerrainCondition(terrainCond) && <button className={styles.btn} onClick={() => setTerrainCond(NO_TERRAIN_CONDITIONS)}>地形の条件をクリア</button>}
                <p className={styles.sub}>沢は DEM から計算した水の通り道で、実際の水の有無とは違います。上部斜面（肩の目安）は試験的な分類です。</p>
              </>
            )}

            </details>
            <details className={styles.details} open={anyForestLayer(forestLayers)}>
              <summary className={styles.h}>森林（森林計画・植生図）{anyForestLayer(forestLayers) ? '：表示中' : ''}</summary>
            <label className={styles.check}>
              <input type="checkbox" checked={showSpots && spotSpecies === 'tree-mizunara'} onChange={(e) => { setShowSpots(true); setSpotSpecies(e.target.checked ? 'tree-mizunara' : 'all'); }} />
              <span className={styles.swatch} style={{ background: SPOT_COLORS.alive, borderRadius: '50%', boxShadow: '0 0 0 2px #f9a825' }} />現地確認済みのミズナラ（環境スポット）
            </label>
            {!forest && !loaded.forestError && <p className={styles.sub}>この版の地形データには森林がありません（新しい版を「更新して保存」すると使えます）</p>}
            {loaded.forestError && <p className={styles.sub}>{loaded.forestError}</p>}
            {forest && forestHa && (
              <>
                <p className={styles.sub}>森林計画でミズナラが入る林分（{forest.sources.kokuyu?.year ?? '—'}年・国有林／{forest.sources.minyu?.year ?? '—'}年・民有林）</p>
                {([['mz1', '1位'], ['mz2', '2位'], ['mz3', '3位']] as const).map(([k, label]) => (
                  <label key={k} className={styles.check}>
                    <input type="checkbox" checked={forestLayers[k]} onChange={toggleForest(k)} />
                    <span className={styles.swatch} style={{ background: `rgba(${FOREST_COLORS[k].slice(0, 3).join(',')},0.9)` }} />ミズナラ {label}
                    <span className={styles.num}>{forestHa[k].toLocaleString()} ha</span>
                  </label>
                ))}
                <label className={styles.check}>
                  <input type="checkbox" checked={forestLayers.kokuyuNoMizunara} onChange={toggleForest('kokuyuNoMizunara')} />
                  <span className={styles.swatch} style={{ background: `rgb(${FOREST_COLORS.kokuyuNoMizunara.slice(0, 3).join(',')})` }} />国有林でミズナラなし
                  <span className={styles.num}>{forestHa.kokuyuNoMizunara.toLocaleString()} ha</span>
                </label>
                <p className={styles.sub}>林の種類（森林計画）</p>
                {([['broadleafUnknown', '天然林広葉樹（樹種不明）'], ['larch', 'カラマツ人工林'], ['todo', 'トドマツ人工林']] as const).map(([k, label]) => (
                  <label key={k} className={styles.check}>
                    <input type="checkbox" checked={forestLayers[k]} onChange={toggleForest(k)} />
                    <span className={styles.swatch} style={{ background: `rgb(${FOREST_COLORS[k].slice(0, 3).join(',')})` }} />{label}
                    <span className={styles.num}>{forestHa[k].toLocaleString()} ha</span>
                  </label>
                ))}
                <p className={styles.sub}>植生図（{forest.sources.veg?.years ? forest.sources.veg.years.join('〜') : '—'}年調査）のミズナラ系群落（斜線）</p>
                {communities.map((c) => (
                  <label key={c} className={styles.check}>
                    <input type="checkbox" checked={forestLayers.vegMizunara.includes(c)} onChange={toggleCommunity(c)} />
                    <span className={styles.swatch} style={{ background: `repeating-linear-gradient(45deg,rgb(${vegColor(communities, c).slice(0, 3).join(',')}) 0 2px,transparent 2px 5px)` }} />{c}
                    <span className={styles.num}>{(forestHa.veg[c] ?? 0).toLocaleString()} ha</span>
                  </label>
                ))}
                <label className={styles.check}>
                  <input type="checkbox" checked={forestLayers.vegOther} onChange={toggleForest('vegOther')} />
                  <span className={styles.swatch} style={{ background: `rgb(${FOREST_COLORS.vegOther.slice(0, 3).join(',')})` }} />その他の植生
                </label>
                <p className={styles.sub}>調査時点の情報で、今の森林と違う場合があります。天然林広葉樹は樹種が分からないため、ミズナラには含めていません。</p>
              </>
            )}

            </details>
              </>
            )}
            {tab === 'view' && (
              <>
            <h3 className={styles.h}>地図に重ねる</h3>
            <label className={styles.check}><input type="checkbox" checked={show.ridge} onChange={(e) => setShow((s) => ({ ...s, ridge: e.target.checked }))} /><span className={styles.swatch} style={{ background: '#7b2cbf' }} />尾根線</label>
            <label className={styles.check}><input type="checkbox" checked={show.sun} onChange={(e) => setShow((s) => ({ ...s, sun: e.target.checked }))} /><span className={styles.swatch} style={{ background: 'linear-gradient(90deg,#1c3f95,#f6d743)' }} />日射量</label>
            <label className={styles.check}><input type="checkbox" checked={show.road} onChange={(e) => setShow((s) => ({ ...s, road: e.target.checked }))} /><span className={styles.line} style={{ background: '#495057' }} />道路・林道<span className={styles.sub}>（茶=林道・幅3m未満）</span></label>
            <label className={styles.check}><input type="checkbox" checked={show.trail} onChange={(e) => setShow((s) => ({ ...s, trail: e.target.checked }))} /><span className={styles.line} style={{ background: 'repeating-linear-gradient(90deg,#212529 0 3px,transparent 3px 6px)' }} />登山道・徒歩道</label>
            <label className={styles.check}>
              <input type="checkbox" checked={showContours} disabled={!contourBlob} onChange={(e) => setShowContours(e.target.checked)} />
              <span className={styles.line} style={{ background: CONTOUR_STYLE.color }} />等高線<span className={styles.sub}>（10m・太線=50m）</span>
            </label>
            {!contourBlob && <p className={styles.sub}>この版の地形データには等高線がありません（新しい版を「更新して保存」すると使えます）</p>}
            {showContours && contourBlob && !contourError && (
              <p className={styles.sub}>{contours ? `50m線はズーム${MAJOR_MIN_ZOOM}以上、10m線は${MINOR_MIN_ZOOM}以上、標高は${LABEL_MIN_ZOOM}以上で表示` : '等高線を読み込み中…'}</p>
            )}
            {contourError && <p className={styles.sub}>{contourError}</p>}
            <label className={styles.check}>
              <span className={styles.swatch} style={{ background: '#2b8a3e', borderRadius: '50%' }} />Field Log
              <select className={styles.selectSmall} value={fieldLogFilter} onChange={(e) => { setFieldLogFilter(e.target.value as FieldLogFilter); setSpecies(ALL_SPECIES); }} aria-label="Field Log の表示">
                <option value="キノコ">きのこ</option>
                <option value="植物">植物（山菜など）</option>
                <option value="all">すべて</option>
                <option value="none">表示しない</option>
              </select>
              <span className={styles.num}>{logPoints.length}件</span>
            </label>
            {fieldLogFilter !== 'none' && species_.length > 0 && (
              <label className={styles.check}>
                <span className={styles.sub}>種名</span>
                <select className={styles.selectSmall} value={activeSpecies} onChange={(e) => setSpecies(e.target.value)} aria-label="Field Log の種名">
                  <option value={ALL_SPECIES}>すべての種（{species_.length}種）</option>
                  {species_.map((o) => (
                    <option key={o.key} value={o.key}>{o.label}（{o.count}件{o.uncertain ? `・うち？${o.uncertain}` : ''}）</option>
                  ))}
                </select>
              </label>
            )}
            {activeSpecies !== ALL_SPECIES && <p className={styles.sub}>過去に記録した地点です（発生の予測ではありません）。「？」付きの記録は薄い点</p>}
            {entries.length === 0 && <p className={styles.sub}>Field Log はログイン中・読み込み済みのときだけ表示されます</p>}

            <label className={styles.check}>
              <input type="checkbox" checked={showStreams} onChange={(e) => setShowStreams(e.target.checked)} />
              <span className={styles.line} style={{ background: `rgb(${STREAM_COLOR.slice(0, 3).join(',')})` }} />沢の線（集水 10ha 以上）
            </label>
            <h3 className={styles.h}>環境スポット</h3>
            <label className={styles.check}><input type="checkbox" checked={showSpots} onChange={(e) => setShowSpots(e.target.checked)} />地図に表示</label>
            <div className={styles.chips}>
              {KIND_CHOICES.map((k) => (
                <label key={k.id} className={styles.chip}>
                  <input type="checkbox" checked={spotKinds.includes(k.id)} onChange={(e) => setSpotKinds((c) => (e.target.checked ? [...c, k.id] : c.filter((x) => x !== k.id)))} />
                  <span className={styles.swatch} style={{ background: SPOT_COLORS[k.id], borderRadius: '50%' }} />{k.label}
                </label>
              ))}
            </div>
            <label className={styles.check}>
              樹種
              <select className={styles.selectSmall} value={spotSpecies} onChange={(e) => setSpotSpecies(e.target.value)} aria-label="環境スポットの樹種">
                <option value="all">すべて</option>
                {envSpots.species.filter((sp) => sp.kind === 'tree').map((sp) => <option key={sp.id} value={sp.id}>{sp.name}</option>)}
              </select>
              <span className={styles.num}>{visibleSpots.length}件</span>
            </label>
              </>
            )}
            {tab === 'record' && (
              <>
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

            <h3 className={styles.h}>環境スポット（現地の記録）</h3>
            <div className={styles.row}>
              <button className={`${styles.btn} ${styles.primary}`} disabled={!pos} onClick={() => pos && setRecordLoc({ lat: pos.lat, lng: pos.lng, source: 'gps', accuracyM: pos.accuracy })}>現在地で記録</button>
              <label className={styles.btn}>撮った写真から記録<input type="file" accept="image/*" multiple hidden onChange={(e) => { void recordFromPhotos(e.target.files); e.target.value = ''; }} /></label>
            </div>
            {!pos && <p className={styles.sub}>その場では「現在地で記録」。山から戻ってからは「撮った写真から記録」（写真の撮影時の位置と日時を使う）か、地図をタップして「ここを記録」</p>}
            {photoMsg && <p className={styles.warn}>{photoMsg}</p>}
            {unsentSpots > 0 && <p className={styles.sub}>この端末の未送信 {unsentSpots} 件（電波のある所で自動的に送信します）</p>}
            {envSpots.remoteError && <p className={styles.sub}>{envSpots.remoteError}</p>}

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

              </>
            )}
            {tab === 'settings' && (
              <>
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
            <p className={styles.sub}>アプリの版: {APP_BUILD}</p>

            <details className={styles.details}>
              <summary>計算の方法と注意</summary>
              <p className={styles.sub}>
                標高は国土地理院 DEM10 を約{Math.round(manifest.grid.pxM)}m 間隔にまとめて計算。日射は {manifest.params.date} の 1 日分（4〜19時、隣の尾根の影を含む直射。雲・樹冠・散乱光は含まない）。
                尾根線は周囲より高い凸部。道は国土地理院と OpenStreetMap（地図に無い作業道・踏み跡は出ない。廃道・通行止めも道として数える）。
                <b>発生を予測するものではなく、探す場所を絞るための地形の手がかりです。</b>
              </p>
              {forest && (
                <p className={styles.sub}>
                  森林は国有林・民有林の森林計画（小班ごとの樹種 1〜3 位）と環境省の現存植生図を、約{Math.round(manifest.grid.pxM)}m の格子に置き直したもの（格子の中心が入る林分）。
                  小班は数 ha 単位で、一本一本の木ではありません。国有林は {forest.sources.kokuyu?.year ?? '—'} 年時点の計画です。
                </p>
              )}
              <p className={styles.sub}>出典: {manifest.sources.map((s) => s.name).join('、')}</p>
            </details>
              </>
            )}
          </div>
        )}
      </section>

      {probe && (
        <div className={styles.probe} role="status">
          <button className={styles.probeClose} onClick={() => setProbe(null)} aria-label="閉じる">×</button>
          {probe.head && (
            <div className={styles.probeHead}>
              {probe.head.species && <div className={styles.probeSpecies}>樹種 {probe.head.species}</div>}
              {probe.head.note && <div className={styles.probeNote}>{probe.head.note}</div>}
              {probe.head.vegetation && <div>植生 {probe.head.vegetation}</div>}
              {probe.head.spots.length > 0 && <div>近くの環境スポット: {probe.head.spots.join('、')}</div>}
            </div>
          )}
          {probe.lines.map((l) => <div key={l}>{l}</div>)}
          <div className={styles.probeActions}>
            <button className={styles.btn} onClick={() => { setRecordLoc({ lat: probe.lat, lng: probe.lng, source: 'map', accuracyM: null }); setProbe(null); }}>ここを記録</button>
            <a className={styles.btn} href={googleMapsPinUrl(probe.lat, probe.lng)} target="_blank" rel="noreferrer">Googleマップで開く</a>
            <a className={styles.btn} href={googleMapsDirectionsUrl(probe.lat, probe.lng)} target="_blank" rel="noreferrer">ここへの経路</a>
            <button
              className={styles.btn}
              onClick={() => {
                const t = coordText(probe.lat, probe.lng);
                navigator.clipboard?.writeText(t).then(() => setCopied(t), () => setCopied(null));
              }}
            >
              {copied === coordText(probe.lat, probe.lng) ? 'コピーしました' : '座標をコピー'}
            </button>
          </div>
          <div className={styles.sub}>{coordText(probe.lat, probe.lng)}（Googleマップを開いた時だけ座標が Google に渡ります）</div>
        </div>
      )}
      {envSpots.notice && (
        <div className={`${styles.notice} ${envSpots.notice.kind === 'ok' ? styles.noticeOk : envSpots.notice.kind === 'warn' ? styles.noticeWarn : ''}`} role="status" onClick={envSpots.clearNotice}>
          {envSpots.notice.kind === 'ok' ? '✓ ' : ''}{envSpots.notice.text}
        </div>
      )}
      {status && <div className={styles.toast}>{status}</div>}
      {!status && watching && !pos && !gpsError && <div className={styles.toast}>現在地を取得中…</div>}
    </div>
  );
}
