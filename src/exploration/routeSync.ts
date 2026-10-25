import { archiveServerRoute, listServerRoutes, putServerRoute } from '../api/routePlansApi';
import { deleteRoute, fromServer, listRoutes, mergeServerRoutes, saveRoute, toServerBody, type RoutePlan } from './routePlan';

// 探索計画の送る・受け取る（icarus_route_plan_v2_design.md §5）。
// - 保存したら、電波があればすぐサーバーへ。送れなければ端末に「送る途中」で残し、次に開いた時・電波が戻った時に送る
// - 開くたびにサーバーの一覧を取り、端末に保存し直す（iPhone は開けば届いている。圏外でも前に取った分が見られる）
// - v1 の端末だけのルートは、利用者が「サーバーに送る」を押した時だけ送る（自動では送らない）

export async function saveAndSend(plan: RoutePlan, idToken: string | null): Promise<{ sent: boolean }> {
  await saveRoute({ ...plan, pendingUpload: true });
  if (!idToken) return { sent: false };
  try {
    const item = await putServerRoute(plan.id, toServerBody(plan), idToken);
    await saveRoute(fromServer(item, plan.visible));
    return { sent: true };
  } catch {
    return { sent: false };
  }
}

export async function flushPending(idToken: string): Promise<number> {
  let n = 0;
  for (const r of await listRoutes()) {
    if (!r.pendingUpload) continue;
    try { await saveRoute(fromServer(await putServerRoute(r.id, toServerBody(r), idToken), r.visible)); n++; } catch { /* 次の機会に */ }
  }
  return n;
}

export async function syncRoutes(idToken: string | null): Promise<void> {
  if (!idToken) return;
  await flushPending(idToken);
  try { await mergeServerRoutes(await listServerRoutes(idToken)); } catch { /* 端末の分で続ける */ }
}

// 消す: サーバーの計画はアーカイブ（作った本人と admin。サーバーが断れば消さない）、端末だけのものは端末から消す
export async function removeRoute(r: RoutePlan, idToken: string | null): Promise<void> {
  if (r.shared && !r.pendingUpload) {
    if (!idToken) throw new Error('サーバーの計画を消すには電波とログインが要ります');
    await archiveServerRoute(r.id, idToken);
  }
  await deleteRoute(r.id);
}
