import { useState } from 'react';
import {
  DEFAULT_STAY_MIN, densify, hm, hoursText, isStop, kindOf, lengthM, planSummary, routeToGpx, setRouteVisible, stopsLine, WALK_MODES,
  type RoutePlan, type RoutePoint, type WalkMode,
} from '../../exploration/routePlan';
import { removeRoute, saveAndSend } from '../../exploration/routeSync';
import { fetchElevations } from '../../terrain/gsiElevation';
import { SUNSET_ALT, sunDownTime } from '../../terrain/sun';
import styles from './ExplorationMap.module.css';

// 探索計画（ルート予定 v1・v2、icarus_route_plan_v1_design.md・icarus_route_plan_v2_design.md）。
// 一覧（共有の計画と端末だけのルート）と、計画を作る・直す帯。点を足す・動かす操作そのものは地図（ExplorationMap）が持つ

export const ROUTE_COLOR = '#9ccc00'; // 黄緑（道のオレンジ・水の青・GPX の青・林分の赤・群生のマゼンタ・予測地点の紫と分ける）
const sunsetOf = (key: string, lat: number, lng: number) => sunDownTime(key, lat, lng, SUNSET_ALT);
const KIND_LABEL = { via: '経由点', stop: '立ち寄り地点', candidate: '既存候補' } as const;

// 一覧の 2 行目: 予定 4.80km / ↑420m / 約3時間20分 ・ 9:00 → 12:20（日没 16:28）
export function summaryText(r: Pick<RoutePlan, 'points' | 'elevations' | 'mode' | 'plannedDate' | 'startTime' | 'returnTime'>): string {
  const s = planSummary(r, sunsetOf);
  const parts = [`予定 ${(s.stats.lengthM / 1000).toFixed(2)}km`];
  parts.push(s.stats.ascentM === null ? '標高は未取得' : `↑${s.stats.ascentM}m ↓${s.stats.descentM}m`);
  if (s.totalHours !== null) parts.push(`${hoursText(s.totalHours)}${s.stayMin ? `（うち滞在 ${s.stayMin}分）` : ''}`);
  let t = parts.join(' / ');
  if (s.startMin !== null && s.returnMin !== null) t += ` ・ ${hm(s.startMin)} → ${hm(s.returnMin)}`;
  if (s.sunsetMin !== null) t += `（日没 ${hm(s.sunsetMin)}）`;
  return t;
}
// v1 の一覧で使っていた書き方（互換）
export const statsText = summaryText;

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/gpx+xml' }));
  const a = document.createElement('a'); a.href = url; a.download = `${name.replace(/[\\/:*?"<>|]/g, '_') || 'route'}.gpx`;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}

type PanelProps = {
  routes: RoutePlan[];
  editing: boolean;
  idToken: string | null;
  onStartDraw: () => void;
  onEdit: (r: RoutePlan) => void;
  onChanged: () => Promise<void> | void;
  onShow: (r: RoutePlan) => void;
};

export default function RoutePlanPanel({ routes, editing, idToken, onStartDraw, onEdit, onChanged, onShow }: PanelProps) {
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <div className={styles.form} aria-label="探索計画">
      <h3 className={styles.h}>探索計画（ルート予定）</h3>
      <p className={styles.sub}>PC で計画を作るとサーバーに保存され、iPhone で開くと届きます（端末にも保存・圏外でも見られる）。道は自動では探しません</p>
      {!editing && <button className={`${styles.btn} ${styles.primary}`} onClick={onStartDraw}>新しい計画を作る</button>}
      {editing && <p className={styles.sub}>計画を作っています（地図を押すと点が増えます。下の帯で保存）</p>}
      {msg && <p className={styles.warn}>{msg}</p>}
      {routes.map((r) => {
        const mine = !r.shared || r.shared.canEdit;
        const where = r.pendingUpload ? '送る途中（電波が戻れば送ります）' : r.shared ? `共有・${r.shared.createdByName || '作成者'}` : 'この端末だけ';
        return (
          <div key={r.id} className={styles.routeRow} aria-label={`計画 ${r.name}`}>
            <label className={styles.check}>
              <input type="checkbox" checked={r.visible} onChange={async (e) => { await setRouteVisible(r.id, e.target.checked); await onChanged(); }} />
              <span className={styles.swatch} style={{ background: `repeating-linear-gradient(90deg,${ROUTE_COLOR} 0 6px,transparent 6px 9px)` }} />
              <span className={styles.captureText}>
                <b>{r.name}</b>{r.plannedDate ? `・${r.plannedDate}` : ''}{r.purpose ? `・${r.purpose}` : ''}<br />
                <small>{summaryText(r)}</small><br />
                <small>{stopsLine(r.points)}</small><br />
                <small>{where}</small>
                {planSummary(r, sunsetOf).lateForSunset && <><br /><small className={styles.warn}>戻る予定が日没より遅い</small></>}
              </span>
            </label>
            <div className={styles.row}>
              <button className={styles.btn} onClick={() => onShow(r)}>地図で見る</button>
              {mine && !editing && <button className={styles.btn} onClick={() => onEdit(r)}>直す</button>}
              {!r.shared && !r.pendingUpload && (
                <button className={styles.btn} onClick={async () => {
                  const { sent } = await saveAndSend(r, idToken);
                  setMsg(sent ? `「${r.name}」をサーバーに送りました` : `「${r.name}」は送る途中です（電波とログインがある時に送ります）`); await onChanged();
                }}>サーバーに送る</button>
              )}
              <button className={styles.btn} onClick={() => download(r.name, routeToGpx(r))}>GPX</button>
              {mine && (confirmDelete === r.id ? (
                <>
                  <button className={styles.btn} onClick={async () => {
                    try { await removeRoute(r, idToken); setMsg(null); } catch (e) { setMsg(e instanceof Error ? e.message : '消せませんでした'); }
                    setConfirmDelete(null); await onChanged();
                  }}>本当に消す</button>
                  <button className={styles.btn} onClick={() => setConfirmDelete(null)}>やめる</button>
                </>
              ) : <button className={styles.btn} onClick={() => setConfirmDelete(r.id)}>消す</button>)}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// 計画を作る・直す帯（地図の下）。点の一覧（種類・名前・メモ・滞在時間・順番）と保存の入力
type EditorProps = {
  points: RoutePoint[];
  base: RoutePlan | null; // 直す時の元
  sel: number | null;
  idToken: string | null;
  onPoints: (p: RoutePoint[]) => void;
  onSelect: (i: number | null) => void;
  onCancel: () => void;
  onSaved: (sent: boolean) => void;
};
export function RouteEditor({ points, base, sel, idToken, onPoints, onSelect, onCancel, onSaved }: EditorProps) {
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState(base?.name ?? '');
  const [date, setDate] = useState(base?.plannedDate ?? '');
  const [purpose, setPurpose] = useState(base?.purpose ?? '');
  const [mode, setMode] = useState<WalkMode>(base?.mode ?? 'forest');
  const [start, setStart] = useState(base?.startTime ?? '');
  const [ret, setRet] = useState(base?.returnTime ?? '');
  const [elev, setElev] = useState<number[] | null | 'loading'>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const set = (i: number, patch: Partial<RoutePoint>) => onPoints(points.map((p, k) => (k === i ? { ...p, ...patch } : p)));
  const move = (i: number, d: -1 | 1) => { const j = i + d; if (j < 0 || j >= points.length) return; const a = [...points]; [a[i], a[j]] = [a[j], a[i]]; onPoints(a); onSelect(j); };
  const remove = (i: number) => { onPoints(points.filter((_, k) => k !== i)); onSelect(null); };
  const openSave = async () => {
    setSaving(true); setElev('loading'); setMsg(null);
    try { setElev(await fetchElevations(densify(points))); } catch { setElev(null); setMsg('標高を取れませんでした（電波のある所で直すと取れます）。距離だけで保存できます'); }
  };
  const draft: RoutePlan = {
    id: base?.id ?? crypto.randomUUID(), name: name.trim() || `計画 ${date || new Date().toLocaleDateString('ja-JP')}`, plannedDate: date || null, purpose: purpose.trim(), mode,
    points, elevations: Array.isArray(elev) ? elev : null, createdAt: base?.createdAt ?? new Date().toISOString(), visible: base?.visible ?? true,
    startTime: start || null, returnTime: ret || null, shared: base?.shared ?? null,
  };
  const save = async () => { const { sent } = await saveAndSend(draft, idToken); onSaved(sent); };
  const s = planSummary(draft, sunsetOf);
  return (
    <div className={styles.routeBar} role="region" aria-label="計画を作る">
      {!saving ? (
        <>
          <div>点 {points.length}・{(lengthM(points) / 1000).toFixed(2)}km・滞在 {s.stayMin}分</div>
          <div className={styles.routeList} aria-label="点の一覧">
            {points.map((p, i) => (
              <div key={i} className={`${styles.routeItem} ${sel === i ? styles.routeItemOn : ''}`}>
                <button className={styles.routeItemName} onClick={() => onSelect(sel === i ? null : i)}>
                  {i === 0 ? 'S' : i === points.length - 1 ? 'G' : i + 1}. {isStop(p) ? `${p.name || '地点'}（${p.stayMin ?? 0}分）` : '経由点'}{kindOf(p) === 'candidate' ? ' ？' : ''}
                </button>
                <button className={styles.btn} aria-label={`${i + 1} を上へ`} onClick={() => move(i, -1)}>↑</button>
                <button className={styles.btn} aria-label={`${i + 1} を下へ`} onClick={() => move(i, 1)}>↓</button>
                <button className={styles.btn} aria-label={`${i + 1} を消す`} onClick={() => remove(i)}>✕</button>
                {sel === i && (
                  <div className={styles.routeItemEdit}>
                    {kindOf(p) === 'candidate' ? <div>{KIND_LABEL.candidate}{p.setTitle ? `（${p.setTitle}）` : ''}</div> : (
                      <label className={styles.check}>種類
                        <select className={styles.selectSmall} value={kindOf(p)} aria-label="点の種類"
                          onChange={(e) => set(i, e.target.value === 'stop' ? { kind: 'stop', name: p.name || '', stayMin: p.stayMin ?? DEFAULT_STAY_MIN } : { kind: 'via' })}>
                          <option value="via">{KIND_LABEL.via}（線を曲げるだけ）</option>
                          <option value="stop">{KIND_LABEL.stop}</option>
                        </select>
                      </label>
                    )}
                    {isStop(p) && (
                      <>
                        <label className={styles.check}>名前 <input className={styles.input} value={p.name ?? ''} onChange={(e) => set(i, { name: e.target.value })} placeholder="例: 沢を渡る／K20 周辺を探す" aria-label="点の名前" /></label>
                        <label className={styles.check}>メモ <input className={styles.input} value={p.memo ?? ''} onChange={(e) => set(i, { memo: e.target.value })} aria-label="点のメモ" /></label>
                        <label className={styles.check}>滞在 <input className={styles.input} type="number" min={0} max={600} step={5} value={p.stayMin ?? 0} onChange={(e) => set(i, { stayMin: Math.max(0, Math.min(600, Math.round(Number(e.target.value) || 0))) })} aria-label="滞在時間（分）" />分</label>
                      </>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
          <div className={styles.row}>
            <button className={styles.btn} onClick={() => { onPoints(points.slice(0, -1)); onSelect(null); }} disabled={!points.length}>1 つ戻す</button>
            <button className={styles.btn} onClick={onCancel}>やめる</button>
            <button className={`${styles.btn} ${styles.primary}`} onClick={() => void openSave()} disabled={points.length < 2}>保存へ</button>
          </div>
        </>
      ) : (
        <>
          <div>{elev === 'loading' ? '標高を取っています…' : summaryText(draft)}</div>
          <div>{stopsLine(points)}</div>
          {s.lateForSunset && <div className={styles.warn}>戻る予定（{hm(s.returnMin!)}）が日没（{hm(s.sunsetMin!)}）より遅い</div>}
          {msg && <div className={styles.warn}>{msg}</div>}
          <label className={styles.check}>名前 <input className={styles.input} value={name} onChange={(e) => setName(e.target.value)} placeholder="例: 10/27 シモフリシメジ探索" aria-label="計画の名前" /></label>
          <label className={styles.check}>予定日 <input className={styles.input} type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-label="予定日" /></label>
          <label className={styles.check}>目的 <input className={styles.input} value={purpose} onChange={(e) => setPurpose(e.target.value)} placeholder="例: シモフリシメジ／1947 樹冠確認" aria-label="目的" /></label>
          <label className={styles.check}>歩き方
            <select className={styles.selectSmall} value={mode} onChange={(e) => setMode(e.target.value as WalkMode)} aria-label="歩き方">
              {WALK_MODES.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
            </select>
          </label>
          <label className={styles.check}>スタート <input className={styles.input} type="time" value={start} onChange={(e) => setStart(e.target.value)} aria-label="スタート予定時刻" /></label>
          <label className={styles.check}>戻る <input className={styles.input} type="time" value={ret} onChange={(e) => setRet(e.target.value)} aria-label="戻る予定時刻" />
            {s.returnAuto && s.returnMin !== null && <small>（自動 {hm(s.returnMin)}）</small>}
          </label>
          <div className={styles.row}>
            <button className={styles.btn} onClick={() => setSaving(false)}>点に戻る</button>
            <button className={`${styles.btn} ${styles.primary}`} onClick={() => void save()} disabled={elev === 'loading'}>保存</button>
          </div>
        </>
      )}
    </div>
  );
}
