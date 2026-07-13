import { openDB, type IDBPDatabase } from 'idb';
import type { WineNote } from '../types/wine';
import type { PhotoEntry, CommonFields } from '../types/foodLog';

const DB_NAME = 'icarus';
const DB_VERSION = 2;
const STORE = 'notes';
const DRAFT_STORE = 'food_log_draft';

export interface FoodLogDraft {
  id: 'current';
  photos: Array<Omit<PhotoEntry, 'previewUrl'>>;
  commonFields: CommonFields;
  currentPhotoIndex: number;
  savedAt: string;
}

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
        if (!db.objectStoreNames.contains(DRAFT_STORE)) {
          db.createObjectStore(DRAFT_STORE, { keyPath: 'id' });
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
  return all.reverse();
}

export async function getDrafts(): Promise<WineNote[]> {
  const all = await getAllNotes();
  return all.filter(n => n.sync_status === 'local').slice(0, 1);
}

export async function deleteNote(id: string): Promise<void> {
  const db = await getDB();
  await db.delete(STORE, id);
}

export async function saveFoodLogDraft(draft: Omit<FoodLogDraft, 'id' | 'savedAt'>): Promise<void> {
  const db = await getDB();
  await db.put(DRAFT_STORE, { ...draft, id: 'current', savedAt: new Date().toISOString() });
}

export async function loadFoodLogDraft(): Promise<FoodLogDraft | undefined> {
  const db = await getDB();
  return db.get(DRAFT_STORE, 'current');
}

export async function clearFoodLogDraft(): Promise<void> {
  const db = await getDB();
  await db.delete(DRAFT_STORE, 'current');
}
