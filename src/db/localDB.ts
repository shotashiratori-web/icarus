import { openDB, type IDBPDatabase } from 'idb';
import type { WineNote } from '../types/wine';
import type { PhotoEntry, CommonFields, SubmitMode } from '../types/foodLog';

const DB_NAME = 'icarus';
const DB_VERSION = 5;
const STORE = 'notes';
const DRAFT_STORE = 'food_log_draft';
export const QUEUE_STORE = 'submission_queue';
// PC一括写真送信のバッチ永続化。送信開始前にqueued状態で全件保存し、タブを閉じても再開できるようにする
export const PHOTO_BATCH_STORE = 'photo_batch_items';
// Work Log専用のdraft保護（UX-009）。food_log_draftとは別ストア。keyは'create'または`append:${workId}`で、
// 新規作成と各Workへの追記が互いに上書きしないようにする（food_log_draftの単一スロット方式とは異なる）
const WORK_LOG_DRAFT_STORE = 'work_log_draft';

export interface FoodLogDraft {
  id: 'current';
  photos: Array<Omit<PhotoEntry, 'previewUrl'>>;
  commonFields: CommonFields;
  submitMode?: SubmitMode;
  currentPhotoIndex: number;
  savedAt: string;
}

export interface WorkLogDraft {
  key: string; // 'create' | `append:${workId}`
  mode: 'create' | 'append';
  workId?: string;
  workTitle?: string;
  requestId: string;
  title: string;
  type: string;
  content: string;
  datetime: string;
  photoBase64?: string;
  photoCaption: string;
  savedAt: string;
}

let _db: IDBPDatabase | null = null;

// バージョンアップグレード中に他タブが古い接続を握ったまま(blocked)だと、openDB()は永久に解決しない。
// 8秒待っても開けなければ諦めて分かるエラーを返す — UIが「送信中…」のまま無限フリーズするのを防ぐ。
const OPEN_TIMEOUT_MS = 8000;
const BLOCKED_MESSAGE = 'データベースを開けませんでした。このアプリを開いている他のタブを閉じてから、もう一度お試しください。';

export async function getDB() {
  if (!_db) {
    _db = await new Promise<IDBPDatabase>((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        reject(new Error(BLOCKED_MESSAGE));
      }, OPEN_TIMEOUT_MS);

      openDB(DB_NAME, DB_VERSION, {
        upgrade(db) {
          if (!db.objectStoreNames.contains(STORE)) {
            const store = db.createObjectStore(STORE, { keyPath: 'id' });
            store.createIndex('updated_at', 'updated_at');
            store.createIndex('sync_status', 'sync_status');
          }
          if (!db.objectStoreNames.contains(DRAFT_STORE)) {
            db.createObjectStore(DRAFT_STORE, { keyPath: 'id' });
          }
          if (!db.objectStoreNames.contains(QUEUE_STORE)) {
            const store = db.createObjectStore(QUEUE_STORE, { keyPath: 'id' });
            store.createIndex('by_entity', 'entity');
            store.createIndex('by_updatedAt', 'updatedAt');
          }
          if (!db.objectStoreNames.contains(PHOTO_BATCH_STORE)) {
            const store = db.createObjectStore(PHOTO_BATCH_STORE, { keyPath: 'requestId' });
            store.createIndex('by_batchId', 'batchId');
            store.createIndex('by_status', 'status');
          }
          if (!db.objectStoreNames.contains(WORK_LOG_DRAFT_STORE)) {
            db.createObjectStore(WORK_LOG_DRAFT_STORE, { keyPath: 'key' });
          }
        },
        blocked() {
          // 他タブが古いバージョンで開いたままアップグレードを妨げている（このイベント自体は解決を保証しない、タイムアウトに任せる）
          console.warn('[icarus] IndexedDB upgrade blocked by another open tab');
        },
        blocking() {
          // 自分自身が古い接続を握っていて、別タブ/リロードでの新しいアップグレードを妨げている場合は道を譲る
          _db?.close();
          _db = null;
        },
      }).then((db) => {
        if (settled) { db.close(); return; }
        settled = true;
        clearTimeout(timer);
        resolve(db);
      }).catch((err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(err instanceof Error ? err : new Error(String(err)));
      });
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

export function workLogDraftKey(mode: 'create' | 'append', workId?: string): string {
  return mode === 'append' && workId ? `append:${workId}` : 'create';
}

export async function saveWorkLogDraft(draft: Omit<WorkLogDraft, 'savedAt'>): Promise<void> {
  const db = await getDB();
  await db.put(WORK_LOG_DRAFT_STORE, { ...draft, savedAt: new Date().toISOString() });
}

export async function loadWorkLogDraft(key: string): Promise<WorkLogDraft | undefined> {
  const db = await getDB();
  return db.get(WORK_LOG_DRAFT_STORE, key);
}

export async function clearWorkLogDraft(key: string): Promise<void> {
  const db = await getDB();
  await db.delete(WORK_LOG_DRAFT_STORE, key);
}
