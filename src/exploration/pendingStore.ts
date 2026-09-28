import { openDB, type IDBPDatabase } from 'idb';
import type { ExplorationSession, PendingExploration, TrackSegments } from './types';

// Exploration History の端末保存（Stage 2 Web、§4）。端末の pending が正本で、送信はここから行う。
// - GPX 原本は IndexedDB（Service Worker の Cache には入れない。SW はアプリ本体だけの責務）
// - 既存の 'icarus'（ノート・下書き）・'icarus-terrain'（地形）とは別の DB。版数・移行に影響させない
// - 送信済みの原本も自動では消さない（30 日ルールは、条件を確かめる手動の「整理」だけ）

const DB_NAME = 'icarus-exploration';
const DB_VERSION = 1;
const PENDING = 'pending'; // keyPath id
const SESSIONS = 'sessions'; // サーバーの記録の写し（圏外表示用）。keyPath id
const TRACKS = 'tracks'; // サーバーの間引いた軌跡の写し。key = sessionId
const META = 'meta'; // key → 値（例: lastRemoteSync）

let dbPromise: Promise<IDBPDatabase> | null = null;
function db(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(d) {
        if (!d.objectStoreNames.contains(PENDING)) {
          const s = d.createObjectStore(PENDING, { keyPath: 'id' });
          s.createIndex('sha256', 'sha256', { unique: false });
        }
        if (!d.objectStoreNames.contains(SESSIONS)) d.createObjectStore(SESSIONS, { keyPath: 'id' });
        if (!d.objectStoreNames.contains(TRACKS)) d.createObjectStore(TRACKS);
        if (!d.objectStoreNames.contains(META)) d.createObjectStore(META);
      },
    });
  }
  return dbPromise;
}

export async function closeExplorationStoreForTest(): Promise<void> {
  if (dbPromise) (await dbPromise).close();
  dbPromise = null;
}

export async function putPending(p: PendingExploration): Promise<void> {
  await (await db()).put(PENDING, p);
}

export async function getPending(id: string): Promise<PendingExploration | undefined> {
  return (await db()).get(PENDING, id);
}

export async function findPendingBySha(sha256: string): Promise<PendingExploration | undefined> {
  return (await db()).getFromIndex(PENDING, 'sha256', sha256);
}

export async function listPending(): Promise<PendingExploration[]> {
  const all: PendingExploration[] = await (await db()).getAll(PENDING);
  return all.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

// 段階を進める時は、読み直してから部分更新する（同じ記録を別の処理が同時に書き換えても古い値で上書きしない）
export async function updatePending(id: string, patch: Partial<PendingExploration>): Promise<PendingExploration | undefined> {
  const d = await db();
  const tx = d.transaction(PENDING, 'readwrite');
  const cur: PendingExploration | undefined = await tx.store.get(id);
  if (!cur) {
    await tx.done;
    return undefined;
  }
  const next = { ...cur, ...patch, updatedAt: new Date().toISOString() };
  await tx.store.put(next);
  await tx.done;
  return next;
}

// 利用者の操作でだけ消す（整理・誤って選んだ未送信の取り消し）
export async function deletePending(id: string): Promise<void> {
  await (await db()).delete(PENDING, id);
}

// ---- サーバーの記録の写し（圏外でも探索履歴を表示するため） ----
export async function saveRemoteSessions(items: ExplorationSession[], syncedAt: string): Promise<void> {
  const d = await db();
  const tx = d.transaction([SESSIONS, META], 'readwrite');
  await tx.objectStore(SESSIONS).clear();
  for (const it of items) await tx.objectStore(SESSIONS).put(it);
  await tx.objectStore(META).put(syncedAt, 'lastRemoteSync');
  await tx.done;
}

export async function listRemoteSessions(): Promise<{ items: ExplorationSession[]; syncedAt: string | null }> {
  const d = await db();
  return { items: await d.getAll(SESSIONS), syncedAt: (await d.get(META, 'lastRemoteSync')) ?? null };
}

export async function saveRemoteTrack(sessionId: string, track: TrackSegments): Promise<void> {
  await (await db()).put(TRACKS, track, sessionId);
}

export async function getRemoteTrack(sessionId: string): Promise<TrackSegments | undefined> {
  return (await db()).get(TRACKS, sessionId);
}
