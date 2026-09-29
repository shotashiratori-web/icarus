import { submitWithFallback } from '../submission/orchestrator';
import type { SpotSubmissionPayload } from '../submission/adapters/environmentSpotAdapter';
import { getPendingObservation, getPendingSpot, listPendingObservations, listPendingSpots } from './store';
import type { PendingObservation, PendingSpot } from './types';

// 端末に保存した環境スポット・観察を送る（Submission Framework 経由）。失敗は送信キューの保留になり、
// ログイン時・オンライン復帰時に自動で再送される
export async function submitSpot(id: string, idToken: string | null): Promise<boolean> {
  const p = await getPendingSpot(id);
  if (!p) return false;
  const r = await submitWithFallback<SpotSubmissionPayload>({
    entity: 'environmentSpot', itemId: `spot:${id}`, payload: { pendingId: id },
    title: `環境スポット（${p.body.observedAt.slice(0, 10)}）`, displayDate: p.body.observedAt.slice(0, 10), idToken,
  });
  return r.ok;
}

export async function submitObservation(id: string, idToken: string | null): Promise<boolean> {
  const o = await getPendingObservation(id);
  if (!o) return false;
  const r = await submitWithFallback<SpotSubmissionPayload>({
    entity: 'spotObservation', itemId: `obs:${id}`, payload: { pendingId: id },
    title: `環境スポットの観察（${o.input.observedAt.slice(0, 10)}）`, displayDate: o.input.observedAt.slice(0, 10), idToken,
  });
  return r.ok;
}

// 送信キューに載る前にアプリが終了した等で、端末にだけ残っている未送信を拾い直す（スポット → 観察の順）
export async function resumeSpotPending(idToken: string | null): Promise<number> {
  if (!idToken) return 0;
  let n = 0;
  for (const p of await listPendingSpots().catch(() => [] as PendingSpot[])) {
    if (p.stage === 'registered' || (p.lastError && !p.lastError.retryable)) continue;
    n++;
    await submitSpot(p.id, idToken).catch(() => undefined);
  }
  for (const o of await listPendingObservations().catch(() => [] as PendingObservation[])) {
    if (o.stage === 'registered' || (o.lastError && !o.lastError.retryable)) continue;
    n++;
    await submitObservation(o.id, idToken).catch(() => undefined);
  }
  return n;
}
