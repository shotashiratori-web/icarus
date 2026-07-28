import { create } from 'zustand';
import * as queueDB from './queueDB';
import type { SubmissionEntity, SubmissionItem } from './types';

// IndexedDBには変更通知がないため、queueへの書き込みは必ずこのstoreのアクション経由で行い、
// マウント中の全コンポーネントがset()を通じて自動的に再描画される状態にする。
type SubmissionQueueState = {
  items: SubmissionItem[];
  refresh: () => Promise<void>;
  upsert: (item: SubmissionItem) => Promise<void>;
  remove: (id: string) => Promise<void>;
};

export const useSubmissionQueue = create<SubmissionQueueState>((set, get) => ({
  items: [],

  refresh: async () => {
    const items = await queueDB.listAll();
    set({ items });
  },

  upsert: async (item) => {
    await queueDB.put(item);
    const items = get().items.filter((i) => i.id !== item.id);
    set({ items: [...items, item] });
  },

  remove: async (id) => {
    await queueDB.remove(id);
    set({ items: get().items.filter((i) => i.id !== id) });
  },
}));

export function selectCountsByEntity(items: SubmissionItem[]): Partial<Record<SubmissionEntity, number>> {
  const counts: Partial<Record<SubmissionEntity, number>> = {};
  for (const item of items) {
    counts[item.entity] = (counts[item.entity] ?? 0) + 1;
  }
  return counts;
}
