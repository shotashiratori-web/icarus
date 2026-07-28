import { getDB, QUEUE_STORE } from '../db/localDB';
import type { SubmissionItem } from './types';

export async function listAll(): Promise<SubmissionItem[]> {
  const db = await getDB();
  return db.getAll(QUEUE_STORE);
}

export async function get(id: string): Promise<SubmissionItem | undefined> {
  const db = await getDB();
  return db.get(QUEUE_STORE, id);
}

export async function put(item: SubmissionItem): Promise<void> {
  const db = await getDB();
  await db.put(QUEUE_STORE, item);
}

export async function remove(id: string): Promise<void> {
  const db = await getDB();
  await db.delete(QUEUE_STORE, id);
}
