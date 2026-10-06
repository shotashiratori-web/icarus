import { useEffect, useState } from 'react';
import { editErrorMessage, fetchEnvironmentSpotHistory, patchEnvironmentSpot, type SpotHistoryItem } from '../../api/environmentSpotsApi';
import type { EnvironmentSpot } from '../../environmentSpots/types';
import { refetchReason, sameTerrain, terrainRows, terrainState, terrainSummary, type TerrainSnapshot } from '../../terrain/terrainSnapshot';
import styles from './EnvironmentSpots.module.css';

// 記録時の地形（Spot の terrain_json）の表示と「地形情報を再取得」（設計: icarus_spot_terrain_snapshot_area_design.md PR 3）。
// 記録時のスナップショットなので自動では変えない。人が新旧を見比べて訂正した時だけ、理由つきで履歴に残す

type Props = {
  spot: EnvironmentSpot;
  idToken: string | null;
  terrainAt?: (lat: number, lng: number) => Promise<TerrainSnapshot>; // 地点を含む山域で計算（表示中の山域ではなく）
  areaName: (areaId: string) => string;
  onDone: () => void; // 訂正の後に詳細と一覧を取り直す
};

const fmt = (iso: string) => {
  const d = new Date(iso);
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

// 履歴の 1 行で見せる短い要約
function brief(t: unknown, areaName: (areaId: string) => string): string {
  const s = (t ?? null) as TerrainSnapshot | null;
  const st = terrainState(s);
  if (st === 'ok') return `${s!.areaId ? `${areaName(String(s!.areaId))} ` : ''}${String(s!.terrainVersion ?? '')}`.trim();
  return terrainRows(s, areaName)[0].value;
}

export default function SpotTerrainSection({ spot, idToken, terrainAt, areaName, onDone }: Props) {
  const t = spot.terrain as TerrainSnapshot | null;
  const st = terrainState(t);
  const [next, setNext] = useState<TerrainSnapshot | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [history, setHistory] = useState<SpotHistoryItem[]>([]);

  useEffect(() => {
    if (!idToken || !navigator.onLine) return;
    let cancelled = false;
    fetchEnvironmentSpotHistory(spot.id, idToken).then(
      (items) => { if (!cancelled) setHistory(items.filter((h) => h.entityType === 'spot' && h.changes.some((c) => c.field === 'terrain'))); },
      () => undefined,
    );
    return () => { cancelled = true; };
  }, [spot.id, spot.updatedAt, idToken]);

  const line = st === 'ok' ? `${terrainSummary(t!)}（${t!.areaId ? `${areaName(String(t!.areaId))} ` : ''}${String(t!.terrainVersion ?? '')}）`
    : st === 'none' ? null
    : terrainRows(t, areaName)[0].value;

  const refetch = async () => {
    if (!terrainAt) return;
    setBusy(true);
    setMsg(null);
    try {
      setNext(await terrainAt(spot.lat, spot.lng));
    } catch {
      setMsg('地形を計算できませんでした');
    } finally {
      setBusy(false);
    }
  };

  const apply = async () => {
    if (!next || !idToken) return;
    setBusy(true);
    setMsg(null);
    try {
      await patchEnvironmentSpot(spot.id, { requestId: crypto.randomUUID(), expectedUpdatedAt: spot.updatedAt, changes: { terrain: next }, reason: refetchReason(next, areaName) }, idToken);
      setNext(null);
      onDone();
    } catch (e) {
      setMsg(editErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const nextState = terrainState(next);
  const oldRows = terrainRows(t, areaName);
  const newRows = next ? terrainRows(next, areaName) : [];

  return (
    <>
      {line !== null && <p className={st === 'ok' ? styles.sub : styles.warn}>記録時の地形: {line}</p>}
      {history.map((h) => {
        const c = h.changes.find((x) => x.field === 'terrain')!;
        return <p key={h.id} className={styles.sub}>地形の訂正 {fmt(h.editedAt)}・{h.editedByName}: {brief(c.old, areaName)} → {brief(c.new, areaName)}{h.reason ? `（${h.reason}）` : ''}</p>;
      })}
      {spot.status === 'active' && terrainAt && idToken && !next && (
        <div className={styles.actions}>
          <button className={styles.btn} disabled={busy} onClick={() => void refetch()}>{busy ? '地形を計算中…' : '地形情報を再取得'}</button>
        </div>
      )}
      {next && (
        <div className={styles.compareBox}>
          {nextState === 'not_saved' && <p className={styles.warn}>{String(next.areaName ?? areaName(String(next.areaId)))}を端末に保存していないため、再取得できません。全体図からこの山域を保存してから、もう一度押してください</p>}
          {nextState === 'outside' && <p className={styles.warn}>この地点はどの山域にも入らないため、地形を取得できません</p>}
          {nextState === 'ok' && sameTerrain(t, next) && <p className={styles.sub}>記録されている地形と同じです（訂正の必要はありません）</p>}
          {nextState === 'ok' && !sameTerrain(t, next) && (
            <>
              <p className={styles.label}>記録時の地形を訂正しますか？（自動では変わりません。履歴に残ります）</p>
              <table className={styles.compare}>
                <thead><tr><th>項目</th><th>今の記録</th><th>再取得</th></tr></thead>
                <tbody>
                  {newRows.map((r, i) => {
                    // 今の記録が取れていない時は、その理由を 1 行目にだけ出す
                    const old = oldRows.length === 1 ? (i === 0 ? oldRows[0].value : '—') : (oldRows.find((o) => o.label === r.label)?.value ?? '—');
                    return <tr key={r.label} className={old !== r.value ? styles.changed : undefined}><td>{r.label}</td><td>{old}</td><td>{r.value}</td></tr>;
                  })}
                </tbody>
              </table>
              <p className={styles.sub}>理由: {refetchReason(next, areaName)}</p>
            </>
          )}
          <div className={styles.actions}>
            <button className={styles.btn} disabled={busy} onClick={() => { setNext(null); setMsg(null); }}>{nextState === 'ok' && !sameTerrain(t, next) ? 'やめる' : '閉じる'}</button>
            {nextState === 'ok' && !sameTerrain(t, next) && (
              <button className={`${styles.btn} ${styles.primary}`} disabled={busy} onClick={() => void apply()}>{busy ? '送信中…' : 'この内容で訂正する'}</button>
            )}
          </div>
        </div>
      )}
      {msg && <p className={styles.warn}>{msg}</p>}
    </>
  );
}
