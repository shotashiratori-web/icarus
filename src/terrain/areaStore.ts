import { openDB, type IDBPDatabase } from 'idb';
import { fetchTerrainFile } from '../api/terrainApi';
import type { BaseFileName, OptionalFileName, TerrainAreaSummary, TerrainFileName, TerrainManifest } from './types';

// エリアパッケージの端末保存（§5-2）。明示的な「オフライン保存」でだけ保存する（API レスポンスを無差別にためない）。
// 既存の IndexedDB 'icarus'（ノート・下書き）とは別の DB にして、既存の版数・移行に影響させない

const DB_NAME = 'icarus-terrain';
const DB_VERSION = 1;
const FILES = 'files'; // key: `${areaId}/${version}/${file}` → StoredFile（iOS の古い Safari は Blob を IndexedDB に入れられないため ArrayBuffer で持つ）
const AREAS = 'areas'; // key: areaId → SavedArea

export const PACKAGE_FILES: BaseFileName[] = ['terrain.png', 'access.png', 'roads.json', 'hillshade.jpg'];
// 版によって有るものと無いもの（manifest に載っていれば必ずそろえる）。等高線・森林は 2026-09-29 の版から
export const OPTIONAL_FILES: OptionalFileName[] = ['contours.json', 'forest.png', 'forest.json', 'terrain2.png'];

export function packageFilesOf(manifest: TerrainManifest): TerrainFileName[] {
  return [...PACKAGE_FILES, ...OPTIONAL_FILES.filter((f) => manifest.files[f])];
}

export type PackageFiles = Record<BaseFileName, Blob> & Partial<Record<OptionalFileName, Blob>>;

export interface SavedArea {
  areaId: string;
  version: string;
  name: string;
  manifest: TerrainManifest;
  savedAt: string;
  bytes: number;
}

export interface AreaPackage {
  manifest: TerrainManifest;
  files: PackageFiles;
  source: 'saved' | 'network';
  savedAt?: string;
}

interface StoredFile {
  type: string;
  data: ArrayBuffer;
}

let dbPromise: Promise<IDBPDatabase> | null = null;
function db(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(d) {
        if (!d.objectStoreNames.contains(FILES)) d.createObjectStore(FILES);
        if (!d.objectStoreNames.contains(AREAS)) d.createObjectStore(AREAS, { keyPath: 'areaId' });
      },
    });
  }
  return dbPromise;
}

// テスト用: 接続を閉じる（DB を消して作り直せるように）
export async function closeAreaStoreForTest(): Promise<void> {
  if (dbPromise) (await dbPromise).close();
  dbPromise = null;
}

const fileKey = (areaId: string, version: string, file: string) => `${areaId}/${version}/${file}`;
const versionRange = (areaId: string, version: string) => IDBKeyRange.bound(`${areaId}/${version}/`, `${areaId}/${version}/\uffff`);

async function sha256Hex(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function listSavedAreas(): Promise<SavedArea[]> {
  return (await db()).getAll(AREAS);
}

export async function loadSavedArea(areaId: string): Promise<AreaPackage | null> {
  const d = await db();
  const saved: SavedArea | undefined = await d.get(AREAS, areaId);
  if (!saved) return null;
  const files = {} as PackageFiles;
  for (const f of packageFilesOf(saved.manifest)) {
    const stored: StoredFile | undefined = await d.get(FILES, fileKey(areaId, saved.version, f));
    if (!stored) return null; // 途中で消えていたら保存なし扱い（部分的なデータは使わない）
    files[f] = new Blob([stored.data], { type: stored.type });
  }
  return { manifest: saved.manifest, files, source: 'saved', savedAt: saved.savedAt };
}

// 保存済みエリアのファイルを 1 つだけ読む（全体図で陰影図だけ出す時。パッケージ全体は読まない）
export async function loadSavedFile(areaId: string, file: TerrainFileName): Promise<Blob | null> {
  const d = await db();
  const saved: SavedArea | undefined = await d.get(AREAS, areaId);
  if (!saved) return null;
  const stored: StoredFile | undefined = await d.get(FILES, fileKey(areaId, saved.version, file));
  return stored ? new Blob([stored.data], { type: stored.type }) : null;
}

// ネットワークから取得（保存はしない）
export async function fetchAreaPackage(area: TerrainAreaSummary, idToken: string, onProgress?: (done: number, total: number) => void): Promise<AreaPackage> {
  const manifest = JSON.parse(await (await fetchTerrainFile(area.areaId, area.version, 'manifest.json', idToken)).text()) as TerrainManifest;
  if (manifest.areaId !== area.areaId || manifest.version !== area.version) throw new Error('地形データの版が一致しません');
  const files = {} as PackageFiles;
  const names = packageFilesOf(manifest);
  let done = 0;
  for (const f of names) {
    const blob = await fetchTerrainFile(area.areaId, area.version, f, idToken);
    if ((await sha256Hex(blob)) !== manifest.files[f]?.sha256) throw new Error(`地形データ（${f}）が壊れています。もう一度お試しください`);
    files[f] = blob;
    onProgress?.(++done, names.length);
  }
  return { manifest, files, source: 'network' };
}

// 取得済みのパッケージを端末へ保存。同じエリアの古い版は、新しい版を書き終えてから消す
export async function saveAreaPackage(pkg: AreaPackage): Promise<SavedArea> {
  const d = await db();
  const { manifest } = pkg;
  const names = packageFilesOf(manifest);
  const bytes = names.reduce((s, f) => s + pkg.files[f]!.size, 0);
  const prev: SavedArea | undefined = await d.get(AREAS, manifest.areaId);
  const saved: SavedArea = {
    areaId: manifest.areaId, version: manifest.version, name: manifest.name, manifest,
    savedAt: new Date().toISOString(), bytes,
  };
  const stored: [TerrainFileName, StoredFile][] = [];
  for (const f of names) stored.push([f, { type: pkg.files[f]!.type, data: await pkg.files[f]!.arrayBuffer() }]);
  const tx = d.transaction([FILES, AREAS], 'readwrite');
  for (const [f, v] of stored) await tx.objectStore(FILES).put(v, fileKey(manifest.areaId, manifest.version, f));
  await tx.objectStore(AREAS).put(saved);
  await tx.done;
  if (prev && prev.version !== manifest.version) {
    // 古い版のファイルは名前を問わず全部消す（版によってファイルの種類が違うため、キーの範囲で消す）
    const del = d.transaction(FILES, 'readwrite');
    await del.store.delete(versionRange(prev.areaId, prev.version));
    await del.done;
  }
  try {
    await navigator.storage?.persist?.();
  } catch {
    /* 永続化を断られても保存自体は有効 */
  }
  return saved;
}

export async function deleteSavedArea(areaId: string): Promise<void> {
  const d = await db();
  const saved: SavedArea | undefined = await d.get(AREAS, areaId);
  if (!saved) return;
  const tx = d.transaction([FILES, AREAS], 'readwrite');
  await tx.objectStore(FILES).delete(versionRange(areaId, saved.version));
  await tx.objectStore(AREAS).delete(areaId);
  await tx.done;
}

export async function hasAnySavedArea(): Promise<boolean> {
  try {
    return (await listSavedAreas()).length > 0;
  } catch {
    return false;
  }
}
