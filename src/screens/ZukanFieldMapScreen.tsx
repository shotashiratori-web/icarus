import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MapContainer, TileLayer } from 'react-leaflet';
import MarkerClusterGroup from 'react-leaflet-cluster';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import 'leaflet.markercluster/dist/MarkerCluster.css';
import 'leaflet.markercluster/dist/MarkerCluster.Default.css';
import { useZukanFieldStore, computeDuplicateCandidateIds } from '../store/zukanFieldStore';
import { computeDateRange, lastYearSameLabel, type TimeFilterKey } from '../utils/fieldTimeFilter';
import { matchesFilter } from '../utils/fieldFilter';
import { deleteFieldLogEntries } from '../api/zukanApi';
import { useAuth } from '../context/AuthContext';
import FieldMapControls from './FieldMapControls';
import FieldMarker from './FieldMarker';
import FitFieldBounds from './FitFieldBounds';
import BottomSheet, { SNAP_FRACTION } from './BottomSheet';
import { isEnvironmentEntry, type FieldLogEntry } from '../types/zukan';
import type { Screen } from '../App';
import HomeButton from '../components/HomeButton';
import FieldDataFreshness from '../components/FieldDataFreshness';
import styles from './ZukanFieldMapScreen.module.css';

// 地形探索（Exploration Mode Stage 1）。通常モードの bundle を増やさないよう遅延読み込み
const ExplorationMap = lazy(() => import('../components/terrain/ExplorationMap'));

type MapMode = 'normal' | 'terrain';
const MAP_MODE_KEY = 'icarus:field-map-mode';
function loadMapMode(): MapMode {
  try {
    return localStorage.getItem(MAP_MODE_KEY) === 'terrain' ? 'terrain' : 'normal';
  } catch {
    return 'normal';
  }
}

// openGpxDraftId: 「🌲 環境を記録」から YAMAP の GPX を選んだ時。地形探索の「記録」タブでその記録の入力を開く
type Props = { go: (s: Screen) => void; focusEntry?: FieldLogEntry; from: Screen; openGpxDraftId?: string };

export default function ZukanFieldMapScreen({ go, focusEntry, from, openGpxDraftId }: Props) {
  const {
    entries: allEntries, loadState, errorMessage, ensureLoaded, reload,
    dataAsOf, refreshState, silentRefresh, refreshIfStale, recheckImageExpiry,
    searchQuery, kigoFilter, setSearchQuery, setKigoFilter,
    listScrollTop, setListScrollTop, sheetSnap, setSheetSnap,
    timeFilter, setTimeFilter, customDateStart, customDateEnd, setCustomDateRange,
    dimMode, setDimMode,
    sortMode, setSortMode,
  } = useZukanFieldStore();
  const { idToken, staffMe, handleTokenExpired } = useAuth();
  const isAdmin = staffMe?.role === 'admin';

  const [mapMode, setMapMode] = useState<MapMode>(() => (focusEntry ? 'normal' : openGpxDraftId ? 'terrain' : loadMapMode()));
  const switchMapMode = (m: MapMode) => {
    setMapMode(m);
    try { localStorage.setItem(MAP_MODE_KEY, m); } catch { /* 保存できなくても切り替えは有効 */ }
  };
  const [manageMode, setManageMode] = useState(false);
  const [showDupOnly, setShowDupOnly] = useState(false);
  // 環境の記録（木・倒木・地形など）は食材と混ぜないため既定で出さない（icarus_field_log_environment_capture_design.md §2）
  const [showEnv, setShowEnv] = useState(false);
  const envCount = useMemo(() => allEntries.filter(isEnvironmentEntry).length, [allEntries]);
  const entries = useMemo(() => (showEnv ? allEntries : allEntries.filter((e) => !isEnvironmentEntry(e))), [allEntries, showEnv]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const listRef = useRef<HTMLDivElement | null>(null);

  // FieldMapControlsは地図に重ねて表示するオーバーレイ（絞り込み条件次第で行数が変わり高さも変動する）。
  // Leafletはこのオーバーレイの存在を知らないため、ポップアップが上部で開くとオーバーレイの下に隠れてしまう。
  // 実測した高さをポップアップのautoPanPaddingへ渡し、隠れないよう地図側にパンさせる
  const controlsRef = useRef<HTMLDivElement | null>(null);
  const [controlsHeight, setControlsHeight] = useState(0);
  useEffect(() => {
    const el = controlsRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setControlsHeight(entry.contentRect.height));
    observer.observe(el);
    return () => observer.disconnect();
  }, [loadState]);

  const duplicateIds = useMemo(() => computeDuplicateCandidateIds(entries), [entries]);

  const toggleSelected = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const handleDelete = async () => {
    const targets = entries.filter((e) => selectedIds.has(e.id) && e.eventId);
    if (targets.length === 0) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      if (!idToken) throw new Error('ログインが必要です');
      await deleteFieldLogEntries(targets.map((t) => t.eventId), idToken);
      setSelectedIds(new Set());
      setConfirming(false);
      await reload(idToken);
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : '削除に失敗しました');
    } finally {
      setDeleting(false);
    }
  };

  // Field Map D1 Read Path Stage 1: 取得先がWorker /field/map-geojson（要認証）になったため、
  // idTokenが確定してから読み込む（旧GAS版は認証不要だったため未ログインでも読めていた）
  useEffect(() => {
    if (!idToken) return;
    void ensureLoaded(idToken);
  }, [ensureLoaded, idToken]);

  // アプリを開いたまま別のアプリ・タブから戻ってきた時も、古ければ裏で取り直す（Field Map Stale Cache）。
  // 取り直せない間も、期限切れになった写真URLは使わない
  useEffect(() => {
    if (!idToken) return;
    const onReturn = () => {
      if (document.visibilityState !== 'visible') return;
      recheckImageExpiry();
      refreshIfStale(idToken);
    };
    document.addEventListener('visibilitychange', onReturn);
    window.addEventListener('focus', onReturn);
    return () => {
      document.removeEventListener('visibilitychange', onReturn);
      window.removeEventListener('focus', onReturn);
    };
  }, [idToken, refreshIfStale, recheckImageExpiry]);

  // 詳細画面から戻ってきたときに、ボトムシート一覧のスクロール位置を復元する
  useEffect(() => {
    if (loadState === 'ready' && listRef.current) {
      listRef.current.scrollTop = listScrollTop;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadState]);

  const handleListScroll = () => {
    if (listRef.current) setListScrollTop(listRef.current.scrollTop);
  };

  const openDetail = (entry: FieldLogEntry) => {
    go({ name: 'zukanFieldDetail', entry, from: { name: 'zukanFieldMap', focusEntry, from } });
  };

  const kigoOptions = useMemo(() => {
    const set = new Set(entries.map((e) => e.kigo).filter(Boolean));
    return Array.from(set).sort();
  }, [entries]);

  const yearOptions = useMemo(() => {
    const set = new Set(entries.map((e) => e.date.slice(0, 4)).filter((y) => y.length === 4));
    return Array.from(set).sort();
  }, [entries]);

  const dateRange = useMemo(
    () => computeDateRange(timeFilter, new Date(), { start: customDateStart, end: customDateEnd }),
    [timeFilter, customDateStart, customDateEnd],
  );

  const matchedEntries = useMemo(() => {
    const base = entries.filter((e) => matchesFilter(e, dateRange, kigoFilter, searchQuery));
    return showDupOnly ? base.filter((e) => duplicateIds.has(e.id)) : base;
  }, [entries, searchQuery, kigoFilter, dateRange, showDupOnly, duplicateIds]);
  const matchedIds = useMemo(() => new Set(matchedEntries.map((e) => e.id)), [matchedEntries]);

  const isFiltering = timeFilter !== 'all' || !!kigoFilter || !!searchQuery.trim();
  const statusText = useMemo(() => {
    if (searchQuery.trim()) {
      return `🔍 ${searchQuery.trim()} | 表示対象 ${matchedEntries.length}件 / 全${entries.length}件`;
    }
    let base: string;
    if (timeFilter === 'last-year-same') base = `${lastYearSameLabel(new Date())} | 表示対象 ${matchedEntries.length}件 / 全${entries.length}件`;
    else if (isFiltering) base = `表示対象 ${matchedEntries.length}件 / 全${entries.length}件`;
    else base = `📍 全${entries.length}件`;
    if (kigoFilter) base += ` [${kigoFilter}]`;
    return base;
  }, [searchQuery, timeFilter, isFiltering, matchedEntries.length, entries.length, kigoFilter]);

  const initialCenter: [number, number] = focusEntry ? [focusEntry.lat, focusEntry.lng] : [43.1957, 140.7835];
  const initialZoom = focusEntry ? 15 : 12;

  // 「対象外も薄く表示」中に絞り込みをかけると、クラスターの数字は薄いピンも合算されてしまい、
  // ヒットが何件あるクラスターなのか分からなくなる。絞り込み中はヒット数を表示し、
  // ヒットが1件もないクラスターは色を落として目立たなくする
  const clusterIconCreate = useCallback((cluster: { getChildCount: () => number; getAllChildMarkers: () => L.Marker[] }) => {
    const total = cluster.getChildCount();
    if (!isFiltering || !dimMode) {
      const sizeClass = total < 10 ? 'small' : total < 100 ? 'medium' : 'large';
      return L.divIcon({
        html: `<div><span>${total}</span></div>`,
        className: `marker-cluster marker-cluster-${sizeClass}`,
        iconSize: L.point(40, 40),
      });
    }
    const matchedCount = cluster.getAllChildMarkers()
      .filter((m) => (m.options as L.MarkerOptions & { isMatched?: boolean }).isMatched).length;
    const cls = matchedCount > 0 ? styles.clusterMatched : styles.clusterUnmatched;
    return L.divIcon({
      html: `<div><span>${matchedCount > 0 ? matchedCount : total}</span></div>`,
      className: `marker-cluster ${cls}`,
      iconSize: L.point(40, 40),
    });
  }, [isFiltering, dimMode]);

  return (
    <div className={styles.root}>
      <header className={styles.header}>
        <button className={styles.back} onClick={() => go(from)}>← 戻る</button>
        <span className={styles.title}>{mapMode === 'terrain' ? '⛰ 地形探索' : '🗺️ フィールドマップ'}</span>
        <button
          className={styles.modeBtn}
          onClick={() => switchMapMode(mapMode === 'terrain' ? 'normal' : 'terrain')}
          aria-pressed={mapMode === 'terrain'}
        >
          {mapMode === 'terrain' ? '📍 通常' : '⛰ 地形探索'}
        </button>
        <HomeButton go={go} />
      </header>

      <main className={styles.main}>
        {mapMode === 'terrain' && (
          <Suspense fallback={<div className={styles.loading}>地形探索を読み込み中…</div>}>
            <ExplorationMap entries={allEntries} openGpxDraftId={openGpxDraftId} />
          </Suspense>
        )}

        {mapMode === 'normal' && loadState === 'loading' && <div className={styles.loading}>読み込み中…</div>}

        {mapMode === 'normal' && loadState === 'error' && (
          <div className={styles.errorBox}>
            <p className={styles.errorText}>{errorMessage}</p>
            <button className={styles.retryBtn} onClick={() => idToken && reload(idToken)}>再読み込み</button>
          </div>
        )}

        {mapMode === 'normal' && loadState === 'ready' && (
          <>
            <FieldMapControls
              rootRef={controlsRef}
              searchQuery={searchQuery}
              onSearchChange={setSearchQuery}
              kigoOptions={kigoOptions}
              kigoFilter={kigoFilter}
              onKigoChange={setKigoFilter}
              timeFilter={timeFilter}
              onTimeFilterChange={(k: TimeFilterKey) => setTimeFilter(k)}
              yearOptions={yearOptions}
              customDateStart={customDateStart}
              customDateEnd={customDateEnd}
              onCustomDateChange={setCustomDateRange}
              dimMode={dimMode}
              onDimModeChange={setDimMode}
              sortMode={sortMode}
              onSortModeChange={setSortMode}
              statusText={statusText}
              duplicateCount={isAdmin ? duplicateIds.size : 0}
              showDupOnly={showDupOnly}
              onToggleShowDupOnly={() => setShowDupOnly((v) => !v)}
              manageMode={manageMode}
              onToggleManageMode={() => {
                setManageMode((v) => !v);
                setSelectedIds(new Set());
              }}
            />

            {envCount > 0 && (
              <button
                type="button"
                className={`${styles.envToggle} ${showEnv ? styles.envToggleOn : ''}`}
                style={{ top: controlsHeight + 8 }}
                onClick={() => setShowEnv((v) => !v)}
                aria-pressed={showEnv}
              >
                🌲 環境の記録 {envCount}件{showEnv ? '（表示中）' : 'を表示'}
              </button>
            )}
            <MapContainer center={initialCenter} zoom={initialZoom} className={styles.mapWrap}>
              <TileLayer
                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://maps.gsi.go.jp/development/ichiran.html">国土地理院</a>'
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              />
              <TileLayer
                url="https://cyberjapandata.gsi.go.jp/xyz/std/{z}/{x}/{y}.png"
                opacity={0.55}
                className={styles.gsiOverlay}
                maxZoom={18}
              />

              <FitFieldBounds matched={matchedEntries} skipFirst={!!focusEntry} />

              <MarkerClusterGroup chunkedLoading maxClusterRadius={50} spiderfyOnMaxZoom iconCreateFunction={clusterIconCreate}>
                {entries.map((entry) => (
                  <FieldMarker
                    key={entry.id}
                    entry={entry}
                    matched={matchedIds.has(entry.id)}
                    dimMode={dimMode}
                    shouldOpen={focusEntry?.id === entry.id}
                    onOpenDetail={openDetail}
                    highlighted={!!searchQuery.trim() && matchedIds.has(entry.id)}
                    popupTopPadding={controlsHeight}
                    popupBottomFraction={SNAP_FRACTION[sheetSnap]}
                  />
                ))}
              </MarkerClusterGroup>
            </MapContainer>

            <BottomSheet
              snap={sheetSnap}
              onSnapChange={setSheetSnap}
              contentRef={listRef}
              onContentScroll={handleListScroll}
              peek={
                <>
                  <p className={styles.sheetCount}>{matchedEntries.length}件の観察記録</p>
                  <FieldDataFreshness
                    refreshState={refreshState}
                    dataAsOf={dataAsOf}
                    onRetry={() => idToken && void silentRefresh(idToken)}
                    onRelogin={handleTokenExpired}
                  />
                </>
              }
            >
              {matchedEntries.length === 0 ? (
                <p className={styles.empty}>該当する観察記録はありません</p>
              ) : (
                <div key={`${searchQuery}::${kigoFilter}`} className={styles.grid}>
                  {matchedEntries.map((entry) => {
                    const isDup = duplicateIds.has(entry.id);
                    const isSelected = selectedIds.has(entry.id);
                    const selectable = manageMode && isDup && !!entry.eventId;
                    return (
                      <button
                        key={entry.id}
                        className={`${styles.card} ${isSelected ? styles.cardSelected : ''}`}
                        onClick={() => (selectable ? toggleSelected(entry.id) : openDetail(entry))}
                      >
                        {selectable && (
                          <span className={styles.selectMark}>{isSelected ? '☑' : '☐'}</span>
                        )}
                        <div className={styles.photoWrap}>
                          {entry.photoUrl && entry.imageExpired
                            ? <div className={styles.photoPlaceholder}>写真は再取得待ち</div>
                            : entry.photoUrl
                              ? <img className={styles.photo} src={entry.thumbnailUrl || entry.photoUrl} alt={entry.foodName} loading="lazy" />
                              : <div className={styles.photoPlaceholder}>写真なし</div>}
                        </div>
                        <div className={styles.cardBody}>
                          <span className={styles.foodName}>{entry.foodName || '無題'}</span>
                          <span className={styles.metaRow}>
                            <span className={styles.place}>📍 {entry.place || '場所不明'}</span>
                            <span className={styles.date}>{entry.date}</span>
                          </span>
                          {entry.kigo && <span className={styles.tag}>{entry.kigo}</span>}
                          {isDup && <span className={styles.dupTag}>⚠ 重複候補</span>}
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </BottomSheet>

            {manageMode && selectedIds.size > 0 && (
              <div className={styles.deleteBar}>
                {!confirming ? (
                  <>
                    <span>{selectedIds.size}件選択中</span>
                    <button className={styles.deleteBtn} onClick={() => setConfirming(true)}>削除する</button>
                  </>
                ) : (
                  <>
                    <span>本当に{selectedIds.size}件削除しますか？（Sheets行削除・元に戻せません）</span>
                    <button className={styles.deleteBtn} onClick={() => void handleDelete()} disabled={deleting}>
                      {deleting ? '削除中…' : '実行する'}
                    </button>
                    <button className={styles.cancelDeleteBtn} onClick={() => setConfirming(false)} disabled={deleting}>
                      キャンセル
                    </button>
                  </>
                )}
                {deleteError && <span className={styles.deleteErrorText}>{deleteError}</span>}
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}
