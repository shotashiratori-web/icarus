import { submitWithFallback } from '../submission/orchestrator';
import type { ExplorationSubmissionPayload } from '../submission/adapters/explorationSessionAdapter';
import { getPending } from './pendingStore';
import { resumeAllPending } from './sync';

// 端末に保存した探索の記録を送る（Submission Framework 経由）。失敗は送信キューの保留になり、
// ログイン時・オンライン復帰時の resendAll で自動的に再送される
export async function submitExploration(id: string, idToken: string | null): Promise<boolean> {
  const p = await getPending(id);
  if (!p) return false;
  const r = await submitWithFallback<ExplorationSubmissionPayload>({
    entity: 'explorationSession',
    itemId: id,
    payload: { pendingId: id },
    title: `探索の記録（${p.preview.exploredOn ?? p.fileName}）`,
    displayDate: p.preview.exploredOn ?? undefined,
    idToken,
  });
  return r.ok;
}

// 送信キューに載る前にアプリが終了した等で、端末にだけ残っている未送信を拾い直す
export function resumeExplorationPending(idToken: string | null): Promise<number> {
  return resumeAllPending(idToken, (id) => submitExploration(id, idToken));
}
