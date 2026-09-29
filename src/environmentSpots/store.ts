import { openDB, type IDBPDatabase } from 'idb';
import type { EnvSpeciesItem, EnvironmentSpot, PendingObservation, PendingSpot } from './types';

// Environment Spots の端末保存（S3 §3-2・§7-5）。未送信の記録と写真の原本は端末が正本（送信前にアプリを終了しても失わない）。
// 既存の 'icarus'・'icarus-terrain'・'icarus-exploration' とは別の DB（版数・移行に影響させない）

const DB_NAME = 'icarus-environment-spots';
const DB_VERSION = 1;
const PENDING = 'pendingSpots'; // keyPath id
const PENDING_OBS = 'pendingObservations'; // keyPath id
const REMOTE = 'remoteSpots'; // サーバーの一覧の写し（圏外表示用）。keyPath id
const META = 'meta'; // species・lastRemoteSync

let dbPromise: Promise<IDBPDatabase> | null = null;
function db(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(d) {
        if (!d.objectStoreNames.contains(PENDING)) d.createObjectStore(PENDING, { keyPath: 'id' });
        if (!d.objectStoreNames.contains(PENDING_OBS)) d.createObjectStore(PENDING_OBS, { keyPath: 'id' });
        if (!d.objectStoreNames.contains(REMOTE)) d.createObjectStore(REMOTE, { keyPath: 'id' });
        if (!d.objectStoreNames.contains(META)) d.createObjectStore(META);
      },
    });
  }
  return dbPromise;
}

export async function closeSpotStoreForTest(): Promise<void> {
  if (dbPromise) (await dbPromise).close();
  dbPromise = null;
}

export async function putPendingSpot(p: PendingSpot): Promise<void> {
  await (await db()).put(PENDING, p);
}
export async function getPendingSpot(id: string): Promise<PendingSpot | undefined> {
  return (await db()).get(PENDING, id);
}
export async function listPendingSpots(): Promise<PendingSpot[]> {
  const all: PendingSpot[] = await (await db()).getAll(PENDING);
  return all.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
// 段階を進める時は読み直してから部分更新（同時に書き換えても古い値で上書きしない）
export async function updatePendingSpot(id: string, patch: Partial<PendingSpot> | ((cur: PendingSpot) => Partial<PendingSpot>)): Promise<PendingSpot | undefined> {
  const d = await db();
  const tx = d.transaction(PENDING, 'readwrite');
  const cur: PendingSpot | undefined = await tx.store.get(id);
  if (!cur) {
    await tx.done;
    return undefined;
  }
  const next = { ...cur, ...(typeof patch === 'function' ? patch(cur) : patch), updatedAt: new Date().toISOString() };
  await tx.store.put(next);
  await tx.done;
  return next;
}

export async function putPendingObservation(p: PendingObservation): Promise<void> {
  await (await db()).put(PENDING_OBS, p);
}
export async function getPendingObservation(id: string): Promise<PendingObservation | undefined> {
  return (await db()).get(PENDING_OBS, id);
}
export async function listPendingObservations(): Promise<PendingObservation[]> {
  const all: PendingObservation[] = await (await db()).getAll(PENDING_OBS);
  return all.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}
export async function updatePendingObservation(id: string, patch: Partial<PendingObservation>): Promise<PendingObservation | undefined> {
  const d = await db();
  const tx = d.transaction(PENDING_OBS, 'readwrite');
  const cur: PendingObservation | undefined = await tx.store.get(id);
  if (!cur) {
    await tx.done;
    return undefined;
  }
  const next = { ...cur, ...patch, updatedAt: new Date().toISOString() };
  await tx.store.put(next);
  await tx.done;
  return next;
}

// ---- サーバーの写し（圏外でも地図に出す） ----
export async function saveRemoteSpots(items: EnvironmentSpot[], syncedAt: string): Promise<void> {
  const d = await db();
  const tx = d.transaction([REMOTE, META], 'readwrite');
  await tx.objectStore(REMOTE).clear();
  for (const it of items) await tx.objectStore(REMOTE).put(it);
  await tx.objectStore(META).put(syncedAt, 'lastRemoteSync');
  await tx.done;
}
export async function listRemoteSpots(): Promise<{ items: EnvironmentSpot[]; syncedAt: string | null }> {
  const d = await db();
  return { items: await d.getAll(REMOTE), syncedAt: (await d.get(META, 'lastRemoteSync')) ?? null };
}
export async function saveSpecies(items: EnvSpeciesItem[]): Promise<void> {
  await (await db()).put(META, items, 'species');
}
export async function loadSpecies(): Promise<EnvSpeciesItem[] | null> {
  return ((await (await db()).get(META, 'species')) as EnvSpeciesItem[] | undefined) ?? null;
}
