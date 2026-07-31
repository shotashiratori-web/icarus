import { create } from 'zustand';
import { searchWorkLogs, NetworkUnknownError } from '../api/workApi';
import { TokenExpiredError } from '../api/icarusApi';
import type { WorkSearchItem } from '../types/workLog';

export type HasPhotoOption = 'all' | 'withPhoto' | 'withoutPhoto';

export interface WorkSearchConditions {
  query: string;
  dateStart: string;
  dateEnd: string;
  hasPhotoOption: HasPhotoOption;
}

export const EMPTY_CONDITIONS: WorkSearchConditions = {
  query: '', dateStart: '', dateEnd: '', hasPhotoOption: 'all',
};

export function isFiltered(c: WorkSearchConditions): boolean {
  return c.query.trim() !== '' || c.dateStart !== '' || c.dateEnd !== '' || c.hasPhotoOption !== 'all';
}

function hasPhotoParam(option: HasPhotoOption): boolean | undefined {
  if (option === 'withPhoto') return true;
  if (option === 'withoutPhoto') return false;
  return undefined;
}

const PAGE_LIMIT = 20;

type LoadState = 'idle' | 'loading' | 'searching' | 'ready' | 'error';

type WorkSearchStore = {
  draft: WorkSearchConditions;
  applied: WorkSearchConditions;
  items: WorkSearchItem[];
  totalCount: number;
  limit: number;
  offset: number;
  hasMore: boolean;
  loadState: LoadState;
  errorMessage: string;
  dateRangeError: string;
  hasLoadedOnce: boolean;

  // 一覧画面に戻ってきても同じ絞り込みパネルの開閉状態を復元するため保持する
  filterPanelOpen: boolean;
  setFilterPanelOpen: (open: boolean) => void;

  setDraftQuery: (q: string) => void;
  setDraftDateStart: (d: string) => void;
  setDraftDateEnd: (d: string) => void;
  setDraftHasPhotoOption: (o: HasPhotoOption) => void;

  // 既に読み込み済みなら再fetchせず、保持済みの条件・結果をそのまま表示する
  ensureLoaded: (token: string) => Promise<void>;
  applyDraft: (token: string) => Promise<void>;
  retry: (token: string) => Promise<void>;
  clear: (token: string) => Promise<void>;
};

async function runSearch(
  set: (partial: Partial<WorkSearchStore>) => void,
  get: () => WorkSearchStore,
  token: string,
  conditions: WorkSearchConditions,
): Promise<void> {
  const hadItems = get().items.length > 0;
  set({ loadState: hadItems ? 'searching' : 'loading', errorMessage: '' });
  try {
    const result = await searchWorkLogs({
      query: conditions.query.trim() || undefined,
      dateStart: conditions.dateStart || undefined,
      dateEnd: conditions.dateEnd || undefined,
      hasPhoto: hasPhotoParam(conditions.hasPhotoOption),
      limit: PAGE_LIMIT,
      offset: 0,
    }, token);
    set({
      items: result.items,
      totalCount: result.totalCount,
      limit: result.limit,
      offset: result.offset,
      hasMore: result.hasMore,
      loadState: 'ready',
      hasLoadedOnce: true,
    });
  } catch (e) {
    if (e instanceof TokenExpiredError) {
      set({ loadState: hadItems ? 'ready' : 'idle' });
      throw e;
    }
    const message = e instanceof NetworkUnknownError ? e.message : e instanceof Error ? e.message : '取得に失敗しました';
    set({ loadState: 'error', errorMessage: message });
  }
}

export const useWorkSearchStore = create<WorkSearchStore>((set, get) => ({
  draft: EMPTY_CONDITIONS,
  applied: EMPTY_CONDITIONS,
  items: [],
  totalCount: 0,
  limit: PAGE_LIMIT,
  offset: 0,
  hasMore: false,
  loadState: 'idle',
  errorMessage: '',
  dateRangeError: '',
  hasLoadedOnce: false,
  filterPanelOpen: false,

  setFilterPanelOpen: (open) => set({ filterPanelOpen: open }),
  setDraftQuery: (q) => set((s) => ({ draft: { ...s.draft, query: q } })),
  setDraftDateStart: (d) => set((s) => ({ draft: { ...s.draft, dateStart: d } })),
  setDraftDateEnd: (d) => set((s) => ({ draft: { ...s.draft, dateEnd: d } })),
  setDraftHasPhotoOption: (o) => set((s) => ({ draft: { ...s.draft, hasPhotoOption: o } })),

  ensureLoaded: async (token) => {
    if (get().hasLoadedOnce || get().loadState === 'loading') return;
    await runSearch(set, get, token, get().applied);
  },

  applyDraft: async (token) => {
    const draft = get().draft;
    if (draft.dateStart && draft.dateEnd && draft.dateStart > draft.dateEnd) {
      set({ dateRangeError: '開始日は終了日より前の日付にしてください' });
      return;
    }
    set({ dateRangeError: '', applied: draft });
    await runSearch(set, get, token, draft);
  },

  retry: async (token) => {
    await runSearch(set, get, token, get().applied);
  },

  clear: async (token) => {
    set({ draft: EMPTY_CONDITIONS, applied: EMPTY_CONDITIONS, dateRangeError: '' });
    await runSearch(set, get, token, EMPTY_CONDITIONS);
  },
}));
