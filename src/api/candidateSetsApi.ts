import { EXPLORATION_URL, request } from './explorationApi';
import type { CandidatePin } from '../exploration/candidatePins';

// 予測地点（検証候補）のスタッフ共有（icarus-api /exploration/candidate-sets、icarus_field_candidate_pins_v2_shared_design.md）
// 共有は利用者の明示操作だけ（「スタッフと共有」）。消すはアーカイブ（登録した本人と admin だけ。記録は残る）

export interface SharedCandidateSet {
  id: string;
  title: string;
  fileName: string;
  pinCount: number;
  pins: CandidatePin[];
  status: 'active' | 'archived';
  createdBy: string;
  createdByName: string;
  createdAt: string;
  canArchive: boolean;
}

const URL_ = `${EXPLORATION_URL}/candidate-sets`;

export async function listSharedCandidateSets(idToken: string): Promise<SharedCandidateSet[]> {
  const res = await request(URL_, { method: 'GET' }, idToken);
  return ((await res.json()) as { items: SharedCandidateSet[] }).items;
}

export async function shareCandidateSet(set: { id: string; title: string; fileName: string; pins: CandidatePin[] }, idToken: string): Promise<SharedCandidateSet> {
  const res = await request(URL_, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: set.id, title: set.title, fileName: set.fileName, pins: set.pins }),
  }, idToken);
  return ((await res.json()) as { item: SharedCandidateSet }).item;
}

export async function archiveSharedCandidateSet(id: string, idToken: string): Promise<void> {
  await request(`${URL_}/${encodeURIComponent(id)}`, { method: 'DELETE' }, idToken);
}
