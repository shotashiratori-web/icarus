import { openDB, type IDBPDatabase } from 'idb';
import type { WineNote } from '../types/wine';

const DB_NAME = 'icarus';
const DB_VERSION = 1;
const STORE = 'notes';

let _db: IDBPDatabase | null = null;

async function getDB() {
  if (!_db) {
    _db = await openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE)) {
          const store = db.createObjectStore(STORE, { keyPath: 'id' });
          store.createIndex('updated_at', 'updated_at');
          store.createIndex('sync_status', 'sync_status');
        }
      },
    });
  }
  return _db;
}

export async function saveNote(note: WineNote): Promise<void> {
  const db = await getDB();
  await db.put(STORE, { ...note, updated_at: new Date().toISOString() });
}

export async function getNote(id: string): Promise<WineNote | undefined> {
  const db = await getDB();
  return db.get(STORE, id);
}

export async function getAllNotes(): Promise<WineNote[]> {
  const db = await getDB();
  const all = await db.getAllFromIndex(STORE, 'updated_at');
  return all.reverse(); // 新しい順
}

export async function getDrafts(): Promise<WineNote[]> {
  const all = await getAllNotes();
  return all.filter(n => n.sync_status === 'local').slice(0, 1); // 最新1件のみ
}

export async function deleteNote(id: string): Promise<void> {
  const db = await getDB();
  await db.delete(STORE, id);
}
