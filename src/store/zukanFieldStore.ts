import { create } from 'zustand';
import { fetchFieldLogEntries, NetworkUnknownError } from '../api/zukanApi';
import { loadFieldLogCache, saveFieldLogCache } from '../utils/fieldLogCache';
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

  // データはフィールドマップ画面内で共有する。既に読み込み済みなら再fetchしない。
  // Field Map D1 Read Path Stage 1: 取得先がWorker /field/map-geojson（要認証）になったため、
  // idTokenが必要になった（旧GAS版は認証不要だった）
  ensureLoaded: (idToken: string) => Promise<void>;
  reload: (idToken: string) => Promise<void>;
  silentRefresh: (idToken: string) => Promise<void>;
  updateEntry: (eventId: string, patch: Partial<Pick<FieldLogEntry, 'foodName' | 'place' | 'memo'>>) => void;
  removeEntry: (eventId: string) => void;
  addEntry: (entry: FieldLogEntry) => void;
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

  ensureLoaded: async (idToken) => {
    const { loadState } = get();
    if (loadState === 'ready' || loadState === 'loading') return;

    // サーバーの応答が遅い・止まる場合でも操作可能にするため、キャッシュがあれば即座に表示し、
    // 裏で最新を取り直す（画面をブロックしない）。キャッシュがなければ従来どおり待つ
    const cached = loadFieldLogCache();
    if (cached) {
      set({ entries: sortFieldEntries(cached, get().sortMode), loadState: 'ready' });
      void get().silentRefresh(idToken);
      return;
    }
    await get().reload(idToken);
  },

  reload: async (idToken) => {
    set({ loadState: 'loading', errorMessage: '' });
    try {
      const items = await fetchFieldLogEntries(idToken);
      set({ entries: sortFieldEntries(items, get().sortMode), loadState: 'ready' });
      saveFieldLogCache(items);
    } catch (e) {
      const message = e instanceof NetworkUnknownError ? e.message : e instanceof Error ? e.message : '取得に失敗しました';
      set({ loadState: 'error', errorMessage: message });
    }
  },

  // キャッシュ表示中に裏で最新を取り直す。画面はブロックせず、失敗してもキャッシュ表示のまま維持する
  // （サーバーが遅い・止まっている間もユーザーの操作を妨げないための仕組み）
  silentRefresh: async (idToken) => {
    try {
      const items = await fetchFieldLogEntries(idToken);
      set({ entries: sortFieldEntries(items, get().sortMode), loadState: 'ready' });
      saveFieldLogCache(items);
    } catch {
      // 失敗してもキャッシュの表示を維持する。エラー表示にはしない
    }
  },

  setSortMode: (mode) => set((state) => ({ sortMode: mode, entries: sortFieldEntries(state.entries, mode) })),

  // 詳細画面での編集保存後、一覧・地図に古い値が残らないようストア内の該当entryだけを更新する（再fetchはしない）
  updateEntry: (eventId, patch) => {
    if (!eventId) return;
    set((state) => ({
      entries: state.entries.map((e) => (e.eventId === eventId ? { ...e, ...patch } : e)),
    }));
  },

  // Sheets行削除後、一覧・地図・整理系画面から即座に消えるよう、再fetchせずストアからも取り除く
  removeEntry: (eventId) => {
    if (!eventId) return;
    set((state) => ({ entries: state.entries.filter((e) => e.eventId !== eventId) }));
  },

  // Unit D（Worker+D1新経路）専用。D1保存直後、画面遷移を待たずに一覧・地図へ即時反映する
  // （地図自体はField Map D1 Read Path Stage 1でD1直読みになったが、これは別。詳細画面等から
  // 遷移せずその場で見えるようにするための、fetchし直さないローカル即時反映）。
  addEntry: (entry) => {
    set((state) => ({
      entries: sortFieldEntries([entry, ...state.entries.filter((e) => e.eventId !== entry.eventId)], state.sortMode),
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
