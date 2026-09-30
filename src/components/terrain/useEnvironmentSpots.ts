import { useCallback, useEffect, useMemo, useState } from 'react';
import { fetchEnvironmentSpots, fetchEnvSpecies } from '../../api/environmentSpotsApi';
import { TokenExpiredError } from '../../api/icarusApi';
import { getPendingObservation, getPendingSpot, listPendingObservations, listPendingSpots, listRemoteSpots, loadSpecies, saveRemoteSpots, saveSpecies } from '../../environmentSpots/store';
import { resumeSpotPending, submitObservation, submitSpot } from '../../environmentSpots/submit';
import { saveNewObservation, saveNewSpot } from '../../environmentSpots/sync';
import type {
  EnvSpeciesItem, EnvironmentSpot, EnvType, LifeState, ObservationInput, PendingObservation, PendingPhoto, PendingSpot,
} from '../../environmentSpots/types';

// 地形探索の環境スポット（S3）。表示するのは サーバーの記録（圏外用に端末へ写し）＋ 端末の未送信（自分がまだ送れていないもの）

export interface SpotNotice {
  text: string;
  kind: 'info' | 'ok' | 'warn';
  at: number;
}

export interface SpotMarker {
  key: string;
  origin: 'server' | 'device';
  spotId: string | null;
  pendingId: string | null;
  lat: number;
  lng: number;
  envType: EnvType;
  lifeState: LifeState;
  treeSpeciesId: string | null;
  label: string;
  status: 'registered' | 'saved' | 'sending' | 'failed';
  error: string | null;
  observedAt: string | null;
  remote: EnvironmentSpot | null;
  pending: PendingSpot | null;
}

export function useEnvironmentSpots(idToken: string | null, bbox: [number, number, number, number] | null) {
  const [species, setSpecies] = useState<EnvSpeciesItem[]>([]);
  const [remote, setRemote] = useState<EnvironmentSpot[]>([]);
  const [remoteAsOf, setRemoteAsOf] = useState<string | null>(null);
  const [remoteError, setRemoteError] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingSpot[]>([]);
  const [pendingObs, setPendingObs] = useState<PendingObservation[]>([]);
  // 送信の結果を画面に出す（保存 → 送信中 → 送信しました／未送信）
  const [notice, setNotice] = useState<SpotNotice | null>(null);
  const notify = useCallback((text: string, kind: SpotNotice['kind']) => setNotice({ text, kind, at: Date.now() }), []);
  useEffect(() => {
    if (!notice || notice.kind === 'info') return;
    const t = setTimeout(() => setNotice((n) => (n && n.at === notice.at ? null : n)), 6000);
    return () => clearTimeout(t);
  }, [notice]);

  const refreshLocal = useCallback(async () => {
    setPending(await listPendingSpots().catch(() => []));
    setPendingObs(await listPendingObservations().catch(() => []));
  }, []);

  const refreshRemote = useCallback(async () => {
    if (!idToken || !navigator.onLine) return;
    try {
      const [sp, items] = await Promise.all([fetchEnvSpecies(idToken), fetchEnvironmentSpots(idToken, bbox ?? undefined)]);
      const now = new Date().toISOString();
      await saveSpecies(sp).catch(() => undefined);
      await saveRemoteSpots(items, now).catch(() => undefined);
      setSpecies(sp);
      setRemote(items);
      setRemoteAsOf(now);
      setRemoteError(null);
    } catch (e) {
      setRemoteError(e instanceof TokenExpiredError ? 'ログインの有効期限が切れています（保存済みの環境スポットを表示中）' : '環境スポットを取得できませんでした（保存済みを表示中）');
    }
  }, [idToken, bbox]);

  useEffect(() => {
    void (async () => {
      await refreshLocal();
      const sp = await loadSpecies().catch(() => null);
      if (sp) setSpecies(sp);
      const cached = await listRemoteSpots().catch(() => ({ items: [] as EnvironmentSpot[], syncedAt: null }));
      setRemote(cached.items);
      setRemoteAsOf(cached.syncedAt);
      await refreshRemote();
    })();
  }, [refreshLocal, refreshRemote]);

  const resume = useCallback(async () => {
    if (!idToken) return;
    const before = [
      ...(await listPendingSpots().catch(() => [] as PendingSpot[])).filter((p) => p.stage !== 'registered').map((p) => `s:${p.id}`),
      ...(await listPendingObservations().catch(() => [] as PendingObservation[])).filter((o) => o.stage !== 'registered').map((o) => `o:${o.id}`),
    ];
    await resumeSpotPending(idToken);
    if (before.length) {
      let sent = 0;
      for (const k of before) {
        const id = k.slice(2);
        const st = k.startsWith('s:') ? (await getPendingSpot(id))?.stage : (await getPendingObservation(id))?.stage;
        if (st === 'registered') sent++;
      }
      if (sent) notify(`未送信だった ${sent} 件を送信しました`, 'ok');
    }
    await refreshLocal();
    await refreshRemote();
  }, [idToken, refreshLocal, refreshRemote, notify]);
  useEffect(() => {
    const onOnline = () => void resume();
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, [resume]);

  // 記録: まず端末に保存（ここで失敗しなければ記録は残る）→ 送れれば送る
  const record = useCallback(async (body: PendingSpot['body'], photos: PendingPhoto[]) => {
    const p = await saveNewSpot(body, photos);
    await refreshLocal();
    const label = body.envType === 'tree' ? (body.treeSpeciesText || species.find((s) => s.id === body.treeSpeciesId)?.name || '樹木') : body.envType === 'terrain' ? '地形' : 'その他';
    notify('端末に保存しました。送信中…', 'info');
    void submitSpot(p.id, idToken)
      .catch(() => false)
      .then(async () => {
        const after = await getPendingSpot(p.id).catch(() => undefined);
        if (after?.stage === 'registered') notify(`送信しました（環境スポット: ${label}）`, 'ok');
        else if (after?.lastError && !after.lastError.retryable) notify(`送信できませんでした: ${after.lastError.message}`, 'warn');
        else notify('未送信です。電波のある所で自動的に送信します（記録と写真は端末に保存済み）', 'warn');
      })
      .finally(() => void refreshLocal().then(() => refreshRemote()));
    return p;
  }, [idToken, refreshLocal, refreshRemote, notify, species]);

  const observe = useCallback(async (target: { spotId: string | null; pendingSpotId: string | null }, input: ObservationInput) => {
    const o = await saveNewObservation(target, input);
    await refreshLocal();
    const tgt = input.targetSpeciesId ? species.find((s) => s.id === input.targetSpeciesId)?.name ?? '' : input.targetText ?? '';
    const res = { found: 'あり', not_found: 'なし', not_checked: '見ていない' }[input.result];
    notify('観察を端末に保存しました。送信中…', 'info');
    void submitObservation(o.id, idToken)
      .catch(() => false)
      .then(async () => {
        const after = await getPendingObservation(o.id).catch(() => undefined);
        if (after?.stage === 'registered') notify(`送信しました（観察: ${tgt} ${res}）`, 'ok');
        else if (after?.lastError && !after.lastError.retryable) notify(`送信できませんでした: ${after.lastError.message}`, 'warn');
        else notify('観察は未送信です。電波のある所で自動的に送信します', 'warn');
      })
      .finally(() => void refreshLocal().then(() => refreshRemote()));
    return o;
  }, [idToken, refreshLocal, refreshRemote, notify, species]);

  const speciesName = useCallback((id: string | null) => species.find((s) => s.id === id)?.name ?? null, [species]);

  const markers = useMemo<SpotMarker[]>(() => {
    const out: SpotMarker[] = remote.map((s) => ({
      key: `s:${s.id}`, origin: 'server', spotId: s.id, pendingId: null, lat: s.lat, lng: s.lng, envType: s.envType, lifeState: s.lifeState,
      treeSpeciesId: s.treeSpeciesId, label: s.title, status: 'registered', error: null, observedAt: s.observedAt, remote: s, pending: null,
    }));
    const remoteIds = new Set(remote.map((s) => s.id));
    for (const p of pending) {
      if (p.spotId && remoteIds.has(p.spotId)) continue; // サーバーの写しにあるものはそちらで表示
      const sp = speciesName(p.body.treeSpeciesId ?? null);
      out.push({
        key: `p:${p.id}`, origin: 'device', spotId: p.spotId, pendingId: p.id, lat: p.body.lat, lng: p.body.lng, envType: p.body.envType,
        lifeState: p.body.lifeState, treeSpeciesId: p.body.treeSpeciesId ?? null,
        label: p.body.envType === 'tree' ? `${p.body.treeSpeciesText || sp || '樹種不明'}` : p.body.envType === 'terrain' ? '地形' : 'その他',
        status: p.stage === 'registered' ? 'registered' : p.lastError ? (p.lastError.retryable ? 'saved' : 'failed') : p.attempts > 0 ? 'sending' : 'saved',
        error: p.lastError?.message ?? null, observedAt: p.body.observedAt, remote: null, pending: p,
      });
    }
    return out;
  }, [remote, pending, speciesName]);

  return { species, markers, pendingObs, remoteAsOf, remoteError, record, observe, refreshRemote, refreshLocal, resume, notice, clearNotice: () => setNotice(null) };
}
