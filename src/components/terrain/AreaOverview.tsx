import { useEffect, useMemo, useState } from 'react';
import { CircleMarker, ImageOverlay, MapContainer, Rectangle, TileLayer, Tooltip } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import { areasAt, areaStatus, canOpen, fmtMB, overviewBounds, type AreaEntry, type AreaStatus } from '../../terrain/areaSelection';
import { loadSavedFile } from '../../terrain/areaStore';
import base from './ExplorationMap.module.css';
import styles from './AreaOverview.module.css';

// 全体図（北海道のフィールド入口）。山域の枠・保存の状態・現在地を出し、山域を選んで保存・開く。
// 山域が 3、4 と増えても同じ画面で選べるように、地図（位置関係）と一覧（状態・容量・操作）の 2 段にする。
// 設計: icarus/docs/architecture/icarus_terrain_multi_area_ui_design.md §2-2・§2-3

type Props = {
  entries: AreaEntry[];
  online: boolean;
  currentAreaId: string | null; // 表示中の山域（戻れる時）
  pos: { lat: number; lng: number } | null;
  saving: { areaId: string; text: string } | null;
  error: string | null;
  onOpen: (areaId: string, from: 'saved' | 'network') => void;
  onSave: (areaId: string) => void; // 保存して開く（新しい版の保存も）
  onDelete: (areaId: string) => void;
  onBack: (() => void) | null;
};

const STATUS_LABEL: Record<AreaStatus, string> = {
  saved: '✓ 保存済み',
  update: '⟳ 新しい版あり',
  unsaved: '↓ 未保存',
  unavailable: '未保存（電波が必要）',
};
const STATUS_COLOR: Record<AreaStatus, string> = { saved: '#2e7d32', update: '#e8590c', unsaved: '#1a73e8', unavailable: '#8a8a8a' };

function fmtDay(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// 保存済みの山域の陰影図（オフラインでも位置関係が分かるように枠の中へ）
function useSavedHillshades(entries: AreaEntry[]): Record<string, string> {
  const ids = entries.filter((e) => e.saved).map((e) => `${e.areaId}/${e.saved!.version}`).join(',');
  const [urls, setUrls] = useState<Record<string, string>>({});
  useEffect(() => {
    let cancelled = false;
    const made: string[] = [];
    void (async () => {
      const next: Record<string, string> = {};
      for (const key of ids ? ids.split(',') : []) {
        const areaId = key.split('/')[0];
        const blob = await loadSavedFile(areaId, 'hillshade.jpg').catch(() => null);
        if (!blob || cancelled) continue;
        const u = URL.createObjectURL(blob);
        made.push(u);
        next[areaId] = u;
      }
      if (!cancelled) setUrls(next);
    })();
    return () => {
      cancelled = true;
      made.forEach((u) => URL.revokeObjectURL(u));
    };
  }, [ids]);
  return urls;
}

function useStorageEstimate(): { usage: number; quota: number } | null {
  const [est, setEst] = useState<{ usage: number; quota: number } | null>(null);
  useEffect(() => {
    void navigator.storage?.estimate?.().then((e) => {
      if (e.quota) setEst({ usage: e.usage ?? 0, quota: e.quota });
    }).catch(() => undefined);
  }, []);
  return est;
}

export default function AreaOverview({ entries, online, currentAreaId, pos, saving, error, onOpen, onSave, onDelete, onBack }: Props) {
  const [selected, setSelected] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const hill = useSavedHillshades(entries);
  const est = useStorageEstimate();
  const ob = useMemo(() => overviewBounds(entries, pos), [entries, pos]);
  const hereAreas = pos ? areasAt(entries, pos.lat, pos.lng) : [];
  const sel = entries.find((e) => e.areaId === selected) ?? null;
  const freeText = est ? `端末の空き 約${((est.quota - est.usage) / 1e9).toFixed(1)}GB（目安）` : null;

  if (!ob) {
    return (
      <div className={base.message}>
        <p>{online ? '地形データがまだ用意されていません。' : '保存した山域がありません。電波のある所でログインし、全体図から山域を選んで保存してください。'}</p>
      </div>
    );
  }
  const pad = 0.08;
  const mapBounds: [[number, number], [number, number]] = [[ob.south - pad, ob.west - pad], [ob.north + pad, ob.east + pad]];

  const actionsFor = (e: AreaEntry) => {
    const st = areaStatus(e, online);
    const from = canOpen(e, online);
    const busy = saving?.areaId === e.areaId;
    const size = fmtMB(e.totalBytes);
    return (
      <div className={styles.actions}>
        {busy && <p className={base.sub}>{saving!.text}</p>}
        {(st === 'saved' || st === 'update') && (
          <button className={`${base.btn} ${base.primary}`} onClick={() => onOpen(e.areaId, 'saved')} disabled={!!saving}>開く</button>
        )}
        {st === 'update' && (
          <button className={base.btn} onClick={() => onSave(e.areaId)} disabled={!!saving}>新しい版を保存 {size}</button>
        )}
        {st === 'unsaved' && (
          <>
            <button className={`${base.btn} ${base.primary}`} onClick={() => onSave(e.areaId)} disabled={!!saving}>{e.name}を保存して開く {size}</button>
            <button className={`${base.btn} ${styles.secondary}`} onClick={() => from && onOpen(e.areaId, 'network')} disabled={!!saving}>保存せずに見る（開くたびに {size} を取得）</button>
          </>
        )}
        {st === 'unavailable' && <p className={base.warn}>この山域は未保存です。電波のある所で保存してください</p>}
        {e.saved && (confirmDelete === e.areaId ? (
          <>
            <button className={base.btn} onClick={() => { setConfirmDelete(null); onDelete(e.areaId); }} disabled={!!saving}>保存を削除する（{fmtMB(e.saved.bytes)}）</button>
            <button className={`${base.btn} ${styles.secondary}`} onClick={() => setConfirmDelete(null)}>やめる</button>
          </>
        ) : (
          <button className={`${base.btn} ${styles.secondary}`} onClick={() => setConfirmDelete(e.areaId)} disabled={!!saving}>この山域の保存を削除</button>
        ))}
      </div>
    );
  };

  return (
    <div className={styles.root}>
      <div className={styles.header}>
        {onBack ? <button className={base.btn} onClick={onBack}>← 地図へ戻る</button> : <span />}
        <h2 className={styles.title}>山域を選ぶ</h2>
        <span className={base.sub}>{online ? '' : 'オフライン'}</span>
      </div>
      <div className={styles.mapWrap}>
        <MapContainer className={styles.map} bounds={mapBounds} minZoom={6} maxZoom={13} zoomControl attributionControl preferCanvas>
          {online && (
            <TileLayer
              url="https://cyberjapandata.gsi.go.jp/xyz/pale/{z}/{x}/{y}.png"
              maxZoom={18}
              attribution='<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank" rel="noreferrer">国土地理院</a>'
            />
          )}
          {entries.map((e) => hill[e.areaId] && e.saved && (
            <ImageOverlay key={`h-${e.areaId}`} url={hill[e.areaId]} bounds={[[e.saved.manifest.bounds.south, e.saved.manifest.bounds.west], [e.saved.manifest.bounds.north, e.saved.manifest.bounds.east]]} opacity={online ? 0.55 : 1} />
          ))}
          {entries.map((e) => {
            const st = areaStatus(e, online);
            return (
              <Rectangle
                key={e.areaId}
                bounds={[[e.bounds.south, e.bounds.west], [e.bounds.north, e.bounds.east]]}
                pathOptions={{ color: STATUS_COLOR[st], weight: e.areaId === selected || e.areaId === currentAreaId ? 4 : 2, fillOpacity: e.saved ? 0.04 : 0.12, dashArray: st === 'unavailable' ? '6 6' : undefined }}
                eventHandlers={{ click: () => { setSelected(e.areaId); setConfirmDelete(null); } }}
              >
                <Tooltip permanent direction="center" className={styles.label}>{e.name}<br />{STATUS_LABEL[st]}</Tooltip>
              </Rectangle>
            );
          })}
          {pos && <CircleMarker center={[pos.lat, pos.lng]} radius={7} pathOptions={{ color: '#fff', weight: 3, fillColor: '#1a73e8', fillOpacity: 1 }} />}
        </MapContainer>
      </div>
      <div className={styles.list}>
        {saving && !entries.some((e) => e.areaId === saving.areaId) && <p className={base.here}>{saving.text}</p>}
        {pos && <p className={base.sub}>{hereAreas.length ? `現在地は${hereAreas.map((a) => a.name).join('・')}の中です` : '現在地はどの山域にも入っていません'}</p>}
        {entries.map((e) => {
          const st = areaStatus(e, online);
          const open = selected === e.areaId;
          return (
            <div key={e.areaId} className={`${styles.item} ${open ? styles.itemOpen : ''}`}>
              <button className={styles.itemHead} onClick={() => { setSelected(open ? null : e.areaId); setConfirmDelete(null); }} aria-expanded={open}>
                <span className={styles.itemName}>{e.name}{e.areaId === currentAreaId ? '（表示中）' : ''}</span>
                <span className={styles.itemStatus} style={{ color: STATUS_COLOR[st] }}>{STATUS_LABEL[st]}</span>
                <span className={styles.itemSize}>{e.saved ? fmtMB(e.saved.bytes) : fmtMB(e.totalBytes)}</span>
              </button>
              {open && (
                <div className={styles.itemBody}>
                  {e.saved && <p className={base.sub}>保存した版 {e.saved.version}（{fmtDay(e.saved.savedAt)} 保存）{e.remote && e.remote.version !== e.saved.version ? ` → 新しい版 ${e.remote.version}` : ''}</p>}
                  {actionsFor(e)}
                </div>
              )}
            </div>
          );
        })}
        {sel === null && <p className={base.sub}>地図の枠か一覧から山域を選んでください。保存は山域ごとで、保存した山域は電波が無くても開けます。</p>}
        {freeText && <p className={base.sub}>{freeText}</p>}
        {error && <p className={base.warn}>{error}</p>}
      </div>
    </div>
  );
}
