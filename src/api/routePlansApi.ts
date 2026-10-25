import { EXPLORATION_URL, request } from './explorationApi';
import type { ServerPlan } from '../exploration/routePlan';

// 探索計画（icarus-api /exploration/route-plans、icarus_route_plan_v2_design.md）。閲覧はスタッフ全員、直す・消すは作った本人と admin
const URL_ = `${EXPLORATION_URL}/route-plans`;

export async function listServerRoutes(idToken: string): Promise<ServerPlan[]> {
  const res = await request(URL_, { method: 'GET' }, idToken);
  return ((await res.json()) as { items: ServerPlan[] }).items;
}
export async function putServerRoute(id: string, body: unknown, idToken: string): Promise<ServerPlan> {
  const res = await request(`${URL_}/${encodeURIComponent(id)}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, idToken);
  return ((await res.json()) as { item: ServerPlan }).item;
}
export async function archiveServerRoute(id: string, idToken: string): Promise<void> {
  await request(`${URL_}/${encodeURIComponent(id)}`, { method: 'DELETE' }, idToken);
}
