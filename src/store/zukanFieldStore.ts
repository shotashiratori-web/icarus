import { create } from 'zustand';
import { fetchFieldLogEntries, NetworkUnknownError } from '../api/zukanApi';
import type { FieldLogEntry } from '../types/zukan';
import type { TimeFilterKey } from '../utils/fieldTimeFilter';
import type { SheetSnap } from '../types/sheet';

type LoadState = 'idle' | 'loading' | 'ready' | 'error';

// 撮影日時順（デフォルトの観察日ベース）とは別に、Icarusへ登録された順の並び替えを提供する
export type FieldSortMode = 'takenDesc' | 'addedDesc' | 'addedAsc';

function sortFieldEntries(entries: FieldLogEntry[], mode: FieldSortMode): FieldLogEntry[] {
  const sorted = [...entries];
  if (mode === 'addedDesc') {
    sorted.sort((a, b) => b.recordedAt.localeCompare(a.recordedAt));
  } else if (mode === 'addedAsc') {
    sorted.sort((a, b) => a.recordedAt.localeCompare(b.recordedAt));
  } else {
    sorted.sort((a, b) => b.date.localeCompare(a.date));
  }
  return sorted;
}

// 撮影日時（秒単位）+GPSが完全一致するレコードを重複候補とみなす。
// 同じグループ内では最初に登録された1件（recordedAtが最も古い）だけを残し、残りを候補としてマークする。
export function computeDuplicateCandidateIds(entries: FieldLogEntry[]): Set<string> {
  const groups = new Map<string, FieldLogEntry[]>();
  for (const e of entries) {
    if (!e.takenAt) continue;
    const key = `${e.takenAt}_${e.lat.toFixed(6)}_${e.lng.toFixed(6)}`;
    const list = groups.get(key);
    if (list) list.push(e); else groups.set(key, [e]);
  }
  const candidates = new Set<string>();
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const sorted = [...group].sort((a, b) => a.recordedAt.localeCompare(b.recordedAt));
    for (let i = 1; i < sorted.length; i++) candidates.add(sorted[i].id);
  }
  return candidates;
}

type ZukanFieldStore = {
  entries: FieldLogEntry[];
  sortMode: FieldSortMode;
  loadState: LoadState;
  errorMessage: string;

  // 検索・タグ絞り込み（地図のピンとボトムシート一覧で共通利用）
  searchQuery: string;
  kigoFilter: string;

  // ボトムシートのUI状態。詳細画面へ遷移して戻ってきても同じ見た目に復元するため保持する
  listScrollTop: number;
  sheetSnap: SheetSnap;

  // GAS版マップの時間フィルター相当
  timeFilter: TimeFilterKey;
  customDateStart: string;
  customDateEnd: string;
  dimMode: boolean; // true: 対象外を薄く表示 / false: 対象外を非表示

  // データはフィールドマップ画面内で共有する。既に読み込み済みなら再fetchしない
  ensureLoaded: () => Promise<void>;
  reload: () => Promise<void>;
  updateEntryMemo: (eventId: string, memo: string) => void;
  setSortMode: (mode: FieldSortMode) => void;
  setSearchQuery: (q: string) => void;
  setKigoFilter: (k: string) => void;
  setListScrollTop: (top: number) => void;
  setSheetSnap: (snap: SheetSnap) => void;
  setTimeFilter: (k: TimeFilterKey) => void;
  setCustomDateRange: (start: string, end: string) => void;
  setDimMode: (dim: boolean) => void;
};

export const useZukanFieldStore = create<ZukanFieldStore>((set, get) => ({
  entries: [],
  sortMode: 'addedDesc',
  loadState: 'idle',
  errorMessage: '',
  searchQuery: '',
  kigoFilter: '',
  listScrollTop: 0,
  sheetSnap: 'collapsed',
  timeFilter: 'all',
  customDateStart: '',
  customDateEnd: '',
  dimMode: true,

  ensureLoaded: async () => {
    const { loadState } = get();
    if (loadState === 'ready' || loadState === 'loading') return;
    await get().reload();
  },

  reload: async () => {
    set({ loadState: 'loading', errorMessage: '' });
    try {
      const items = await fetchFieldLogEntries();
      set({ entries: sortFieldEntries(items, get().sortMode), loadState: 'ready' });
    } catch (e) {
      const message = e instanceof NetworkUnknownError ? e.message : e instanceof Error ? e.message : '取得に失敗しました';
      set({ loadState: 'error', errorMessage: message });
    }
  },

  setSortMode: (mode) => set((state) => ({ sortMode: mode, entries: sortFieldEntries(state.entries, mode) })),

  // 詳細画面での編集保存後、一覧・地図に古いメモが残らないようストア内の該当entryだけを更新する（再fetchはしない）
  updateEntryMemo: (eventId, memo) => {
    if (!eventId) return;
    set((state) => ({
      entries: state.entries.map((e) => (e.eventId === eventId ? { ...e, memo } : e)),
    }));
  },

  setSearchQuery: (q) => set({ searchQuery: q }),
  setKigoFilter: (k) => set({ kigoFilter: k }),
  setListScrollTop: (top) => set({ listScrollTop: top }),
  setSheetSnap: (snap) => set({ sheetSnap: snap }),
  setTimeFilter: (k) => set({ timeFilter: k }),
  setCustomDateRange: (start, end) => set({ customDateStart: start, customDateEnd: end }),
  setDimMode: (dim) => set({ dimMode: dim }),
}));
