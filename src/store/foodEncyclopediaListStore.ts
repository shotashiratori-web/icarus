import { create } from 'zustand';
import { fetchFieldFoods } from '../api/fieldFoodApi';
import { NetworkUnknownError } from '../api/workApi';
import { TokenExpiredError } from '../api/icarusApi';
import type { FieldFoodListItem } from '../types/fieldFood';

type LoadState = 'idle' | 'loading' | 'ready' | 'error';

type FoodEncyclopediaListStore = {
  items: FieldFoodListItem[];
  loadState: LoadState;
  errorMessage: string;

  // Food Detail往復（Food Input Cross Navigationでの複数Detail経由も含む）で保持する探索状態。
  // ZukanFieldMapStoreのsearchQuery/listScrollTopと同じ考え方（UX-006対応）
  searchQuery: string;
  largeCategoryFilter: string;
  scrollPosition: number;

  setSearchQuery: (q: string) => void;
  setLargeCategoryFilter: (c: string) => void;
  setScrollPosition: (y: number) => void;

  // 既に読み込み済みなら再fetchせず、保持済みのitems・探索状態をそのまま表示する
  // （useWorkSearchStore/useZukanFieldStoreと同じensureLoadedパターン）
  ensureLoaded: (token: string) => Promise<void>;
  retry: (token: string) => Promise<void>;
};

async function runLoad(
  set: (partial: Partial<FoodEncyclopediaListStore>) => void,
  token: string,
): Promise<void> {
  set({ loadState: 'loading', errorMessage: '' });
  try {
    const result = await fetchFieldFoods({}, token);
    set({ items: result.items, loadState: 'ready' });
  } catch (e) {
    if (e instanceof TokenExpiredError) {
      set({ loadState: 'idle' });
      throw e;
    }
    const message = e instanceof NetworkUnknownError ? e.message : e instanceof Error ? e.message : '取得に失敗しました';
    set({ loadState: 'error', errorMessage: message });
  }
}

export const useFoodEncyclopediaListStore = create<FoodEncyclopediaListStore>((set, get) => ({
  items: [],
  loadState: 'idle',
  errorMessage: '',
  searchQuery: '',
  largeCategoryFilter: '',
  scrollPosition: 0,

  setSearchQuery: (q) => set({ searchQuery: q }),
  setLargeCategoryFilter: (c) => set({ largeCategoryFilter: c }),
  setScrollPosition: (y) => set({ scrollPosition: y }),

  ensureLoaded: async (token) => {
    if (get().loadState === 'ready' || get().loadState === 'loading') return;
    await runLoad(set, token);
  },

  retry: async (token) => {
    await runLoad(set, token);
  },
}));
