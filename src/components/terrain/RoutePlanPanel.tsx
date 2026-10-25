import { useState } from 'react';
import {
  deleteRoute, densify, hoursText, lengthM, routeStats, routeToGpx, saveRoute, setRouteVisible, WALK_MODES,
  type LatLng, type RoutePlan, type WalkMode,
} from '../../exploration/routePlan';
import { fetchElevations } from '../../terrain/gsiElevation';
import styles from './ExplorationMap.module.css';

// ルート予定 v1（icarus_route_plan_v1_design.md）: 一覧（表示する／しない・地図で見る・GPX・消す）と、引いた線の保存。
// 線を引く操作そのもの（地図を押して点を足す）は ExplorationMap が持つ

export const ROUTE_COLOR = '#9ccc00'; // 黄緑（道のオレンジ・水の青・GPX の青・林分の赤・群生のマゼンタ・予測地点の紫と分ける）

export function statsText(r: Pick<RoutePlan, 'points' | 'elevations' | 'mode'>): string {
  const s = routeStats(r.points, r.elevations, r.mode);
  const km = `${(s.lengthM / 1000).toFixed(2)}km`;
  if (s.hours === null) return `${km}・標高は未取得`;
  return `${km}・登り${s.ascentM}m 下り${s.descentM}m・最大${s.maxSlopeDeg}°・${hoursText(s.hours)}（${WALK_MODES.find((m) => m.id === r.mode)?.label.split('（')[0]}の目安）`;
}

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/gpx+xml' }));
  const a = document.createElement('a'); a.href = url; a.download = `${name.replace(/[\\/:*?"<>|]/g, '_') || 'route'}.gpx`;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}

type Props = {
  routes: RoutePlan[];
  drawing: LatLng[] | null;
  onStartDraw: () => void;
  onChanged: () => Promise<void> | void;
  onShow: (r: RoutePlan) => void;
};

export default function RoutePlanPanel({ routes, drawing, onStartDraw, onChanged, onShow }: Props) {
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  return (
    <div className={styles.form} aria-label="ルート予定">
      <h3 className={styles.h}>ルート予定（この端末だけ）</h3>
      <p className={styles.sub}>地図に歩く線を引いて、距離・登り下り・時間の目安を見ます。道は自動では探しません（等高線・沢・尾根・道を見て引く）</p>
      {!drawing && <button className={`${styles.btn} ${styles.primary}`} onClick={onStartDraw}>ルートを引く</button>}
      {drawing && <p className={styles.sub}>線を引いています（地図を押すと点が増えます。下の帯で保存）</p>}
      {routes.map((r) => (
        <div key={r.id} className={styles.candidateRow} aria-label={`ルート ${r.name}`}>
          <label className={styles.check}>
            <input type="checkbox" checked={r.visible} onChange={async (e) => { await setRouteVisible(r.id, e.target.checked); await onChanged(); }} />
            <span className={styles.swatch} style={{ background: `repeating-linear-gradient(90deg,${ROUTE_COLOR} 0 6px,transparent 6px 9px)` }} />
            <span className={styles.captureText}>
              <b>{r.name}</b>{r.plannedDate ? `・${r.plannedDate}` : ''}{r.purpose ? `・${r.purpose}` : ''}<br />
              <small>{statsText(r)}</small>
            </span>
          </label>
          <div className={styles.row}>
            <button className={styles.btn} onClick={() => onShow(r)}>地図で見る</button>
            <button className={styles.btn} onClick={() => download(r.name, routeToGpx(r))}>GPX を書き出す</button>
            {confirmDelete === r.id ? (
              <>
                <button className={styles.btn} onClick={async () => { await deleteRoute(r.id); setConfirmDelete(null); await onChanged(); }}>本当に消す</button>
                <button className={styles.btn} onClick={() => setConfirmDelete(null)}>やめる</button>
              </>
            ) : <button className={styles.btn} onClick={() => setConfirmDelete(r.id)}>消す</button>}
          </div>
        </div>
      ))}
    </div>
  );
}

// 線を引いている間の帯（地図の下）。保存の入力もここで開く
export function RouteDrawBar({ points, onUndo, onCancel, onSaved }: { points: LatLng[]; onUndo: () => void; onCancel: () => void; onSaved: () => void }) {
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState('');
  const [date, setDate] = useState('');
  const [purpose, setPurpose] = useState('');
  const [mode, setMode] = useState<WalkMode>('forest');
  const [elev, setElev] = useState<number[] | null | 'loading'>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const openSave = async () => {
    setSaving(true); setElev('loading'); setMsg(null);
    try { setElev(await fetchElevations(densify(points))); } catch { setElev(null); setMsg('標高を取れませんでした（電波のある所で引き直すと取れます）。距離だけで保存できます'); }
  };
  const save = async () => {
    const r: RoutePlan = {
      id: crypto.randomUUID(), name: name.trim() || `ルート ${new Date().toLocaleDateString('ja-JP')}`, plannedDate: date || null, purpose: purpose.trim(), mode,
      points, elevations: Array.isArray(elev) ? elev : null, createdAt: new Date().toISOString(), visible: true,
    };
    await saveRoute(r); onSaved();
  };
  const preview = { points, elevations: Array.isArray(elev) ? elev : null, mode };
  return (
    <div className={styles.routeBar} role="region" aria-label="ルートを引く">
      {!saving ? (
        <>
          <div>点 {points.length}・{(lengthM(points) / 1000).toFixed(2)}km</div>
          <div className={styles.row}>
            <button className={styles.btn} onClick={onUndo} disabled={!points.length}>1 つ戻す</button>
            <button className={styles.btn} onClick={onCancel}>やめる</button>
            <button className={`${styles.btn} ${styles.primary}`} onClick={() => void openSave()} disabled={points.length < 2}>保存へ</button>
          </div>
        </>
      ) : (
        <>
          <div>{elev === 'loading' ? '標高を取っています…' : statsText(preview)}</div>
          {msg && <div className={styles.warn}>{msg}</div>}
          <label className={styles.check}>名前 <input className={styles.input} value={name} onChange={(e) => setName(e.target.value)} placeholder="例: 10/27 シモフリ M 系" aria-label="ルートの名前" /></label>
          <label className={styles.check}>予定日 <input className={styles.input} type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-label="予定日" /></label>
          <label className={styles.check}>目的 <input className={styles.input} value={purpose} onChange={(e) => setPurpose(e.target.value)} placeholder="例: シモフリシメジ／1947 樹冠確認" aria-label="目的" /></label>
          <label className={styles.check}>歩き方
            <select className={styles.selectSmall} value={mode} onChange={(e) => setMode(e.target.value as WalkMode)} aria-label="歩き方">
              {WALK_MODES.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
            </select>
          </label>
          <div className={styles.row}>
            <button className={styles.btn} onClick={() => setSaving(false)}>線に戻る</button>
            <button className={`${styles.btn} ${styles.primary}`} onClick={() => void save()} disabled={elev === 'loading'}>保存</button>
          </div>
        </>
      )}
    </div>
  );
}
