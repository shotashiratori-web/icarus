import { useCallback, useEffect, useMemo, useState } from 'react';
import { fetchExplorationTrack, listExplorationSessions } from '../../api/explorationApi';
import { TokenExpiredError } from '../../api/icarusApi';
import {
  getRemoteTrack, listPending, listRemoteSessions, saveRemoteSessions, saveRemoteTrack,
} from '../../exploration/pendingStore';
import { resumeExplorationPending, submitExploration } from '../../exploration/submit';
import type { HypothesisSnapshot } from '../../terrain/hypothesis';
import { displayStatus, type DisplayStatus, type ExplorationSession, type PendingExploration, type Purpose, type TargetResult, type TrackSegments } from '../../exploration/types';

// 地形探索の探索履歴レイヤー（Stage 2 Web）。表示するのは:
//   サーバーの記録（登録済み。圏外用に端末へ写しを持つ）＋ 端末の未送信（自分がまだ送れていない GPX）
// 「探索済み」はここでは作らない（ExplorationMap が 軌跡 × 探索幅 × 絞り込み から格子に塗る）

export interface HistoryEntry {
  key: string;
  origin: 'server' | 'device';
  sessionId: string | null;
  pendingId: string | null;
  exploredOn: string | null;
  explorerNames: string[];
  purpose: Purpose;
  targets: { target: string; result: TargetResult }[];
  distanceM: number;
  track: TrackSegments | null;
  status: DisplayStatus; // サーバーの記録は 'registered'
  updatedAt: string | null; // サーバーの記録の楽観ロック用（端末のものは null）
  hypothesis: HypothesisSnapshot | null; // S4b: この探索に使った仮説
}

export function useExplorationHistory(idToken: string | null, areaId: string | null) {
  const [pending, setPending] = useState<PendingExploration[]>([]);
  const [remote, setRemote] = useState<ExplorationSession[]>([]);
  const [tracks, setTracks] = useState<Record<string, TrackSegments>>({});
  const [remoteAsOf, setRemoteAsOf] = useState<string | null>(null);
  const [remoteError, setRemoteError] = useState<string | null>(null);

  const refreshLocal = useCallback(async () => {
    setPending(await listPending().catch(() => []));
  }, []);

  const loadCachedRemote = useCallback(async () => {
    const cached = await listRemoteSessions().catch(() => ({ items: [] as ExplorationSession[], syncedAt: null }));
    const t: Record<string, TrackSegments> = {};
    for (const s of cached.items) {
      const tr = await getRemoteTrack(s.id).catch(() => undefined);
      if (tr) t[s.id] = tr;
    }
    setRemote(cached.items);
    setTracks(t);
    setRemoteAsOf(cached.syncedAt);
  }, []);

  // 電波とログインがあればサーバーから取り直し、端末に写す（軌跡は変わらないので未取得の分だけ取る）
  const refreshRemote = useCallback(async () => {
    if (!idToken || !areaId || !navigator.onLine) return;
    try {
      const items = await listExplorationSessions({ areaId }, idToken);
      const t: Record<string, TrackSegments> = {};
      for (const s of items) {
        let tr = await getRemoteTrack(s.id).catch(() => undefined);
        if (!tr) {
          tr = await fetchExplorationTrack(s.id, idToken);
          await saveRemoteTrack(s.id, tr).catch(() => undefined);
        }
        t[s.id] = tr;
      }
      const now = new Date().toISOString();
      await saveRemoteSessions(items, now).catch(() => undefined);
      setRemote(items);
      setTracks(t);
      setRemoteAsOf(now);
      setRemoteError(null);
    } catch (e) {
      setRemoteError(e instanceof TokenExpiredError ? 'ログインの有効期限が切れています（保存済みの探索履歴を表示中）' : '探索履歴を取得できませんでした（保存済みの探索履歴を表示中）');
    }
  }, [idToken, areaId]);

  useEffect(() => {
    void refreshLocal();
    void loadCachedRemote().then(() => refreshRemote());
  }, [refreshLocal, loadCachedRemote, refreshRemote]);

  // オンライン復帰・起動時: 端末の未送信を送る（送信キューの resendAll とは別に、キューに載る前に終了したものも拾う）
  const resume = useCallback(async () => {
    if (!idToken) return;
    await resumeExplorationPending(idToken);
    await refreshLocal();
    await refreshRemote();
  }, [idToken, refreshLocal, refreshRemote]);
  useEffect(() => {
    void resume();
    const onOnline = () => void resume();
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, [resume]);

  const send = useCallback(async (pendingId: string) => {
    await submitExploration(pendingId, idToken);
    await refreshLocal();
    await refreshRemote();
  }, [idToken, refreshLocal, refreshRemote]);

  const entries = useMemo<HistoryEntry[]>(() => {
    const out: HistoryEntry[] = remote.map((s) => ({
      key: `s:${s.id}`, origin: 'server', sessionId: s.id, pendingId: null, exploredOn: s.exploredOn, explorerNames: s.explorerNames,
      purpose: s.purpose, targets: s.targets.map((t) => ({ target: t.target, result: t.result })), distanceM: s.distanceM,
      track: tracks[s.id] ?? null, status: 'registered', updatedAt: s.updatedAt, hypothesis: s.hypothesis ?? null,
    }));
    const serverShas = new Set(remote.map((s) => s.gpxSha256));
    for (const p of pending) {
      if (serverShas.has(p.sha256)) continue; // サーバーの写しにあるものはそちらで表示
      out.push({
        key: `p:${p.id}`, origin: 'device', sessionId: p.sessionId, pendingId: p.id, exploredOn: p.exploredOnManual ?? p.preview.exploredOn,
        explorerNames: p.explorerNames, purpose: p.purpose, targets: p.targets.map((t) => ({ target: t.target, result: t.result })),
        distanceM: p.preview.distanceM, track: p.preview.track, status: displayStatus(p), updatedAt: null, hypothesis: p.hypothesis ?? null,
      });
    }
    return out.sort((a, b) => (b.exploredOn ?? '').localeCompare(a.exploredOn ?? ''));
  }, [remote, tracks, pending]);

  return { pending, entries, remoteAsOf, remoteError, refreshLocal, refreshRemote, send };
}
