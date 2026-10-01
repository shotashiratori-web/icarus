import { openDB, type IDBPDatabase } from 'idb';
import type { HypothesisSnapshot } from '../terrain/hypothesis';

// 名前つきの仮説（S4 §4-1）。v1 は端末だけ（スタッフ間で共有しない）。
// 探索記録に付けるのはここからのコピー（S4b で exploration_sessions.hypothesis_json へ）。ここを直しても付けたものは変わらない。
// 既存の 'icarus'・'icarus-terrain'・'icarus-exploration'・'icarus-environment-spots' とは別の DB（版数・移行に影響させない）

const DB_NAME = 'icarus-hypotheses';
const STORE = 'hypotheses'; // keyPath id

let dbPromise: Promise<IDBPDatabase> | null = null;
function db(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, 1, {
      upgrade(d) {
        if (!d.objectStoreNames.contains(STORE)) d.createObjectStore(STORE, { keyPath: 'id' });
      },
    });
  }
  return dbPromise;
}

export async function closeHypothesisStoreForTest(): Promise<void> {
  if (dbPromise) (await dbPromise).close();
  dbPromise = null;
}

export async function saveHypothesis(h: HypothesisSnapshot): Promise<void> {
  await (await db()).put(STORE, h);
}

export async function listHypotheses(): Promise<HypothesisSnapshot[]> {
  const all = (await (await db()).getAll(STORE)) as HypothesisSnapshot[];
  return all.sort((a, b) => b.savedAt.localeCompare(a.savedAt));
}

export async function deleteHypothesis(id: string): Promise<void> {
  await (await db()).delete(STORE, id);
}
