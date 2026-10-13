import { openDB, type IDBPDatabase } from 'idb';

// 予測地点（検証候補）ピン v1（icarus/docs/architecture/icarus_field_candidate_pins_v1_design.md）。
// - 予測と観測を混ぜない: Environment Spot・Field Log・探索履歴（GPX の記録）のどれにも入れない
// - 端末だけに保存（D1・API へ送らない）。圏外でも地図に出し「ここへ行く」で案内できる
// - 現地で確かめた後も自動では消さない・Spot に変えない（予測と観測を別々に残し、後で当たり外れを確かめる）。消すのは利用者が明示した時だけ
// 既存の DB とは別の DB（版数・移行に影響させない）

export interface CandidatePin { name: string; desc: string; lat: number; lng: number }
export interface CandidateSet {
  id: string; // GPX の中身の SHA-256（同じファイルを二重に読み込まない）
  fileName: string;
  title: string; // GPX の metadata/name（無ければファイル名）
  importedAt: string;
  visible: boolean;
  pins: CandidatePin[];
}

export class CandidateGpxError extends Error {}

// 一覧の 2 行目: 説明の 2 文目（例「樹冠高 34m（周り…より +11m）」）。無ければ空
export function pinSummary(desc: string): string {
  const parts = desc.split('。').map((t) => t.trim()).filter(Boolean);
  return (parts[0]?.startsWith('予測・未確認') ? parts[1] : parts[0]) ?? '';
}

// 木の大きさの目安（樹冠高 m）。説明の「樹冠高 34m」→ 無ければ名前の「34m」（例「Q01 22m +11 道0m 14°」の最初の ○m）。無ければ null
export function pinHeightM(p: CandidatePin): number | null {
  const m = p.desc.match(/樹冠高\s*(\d+(?:\.\d+)?)\s*m/) ?? p.name.match(/(?:^|[\s-])(\d+(?:\.\d+)?)m(?=\s|$)/);
  return m ? Number(m[1]) : null;
}

// 一覧の並べ方: 読み込んだ順（GPX の順）／大きい木の順（樹冠高の高い順。同じ高さ・高さ不明は GPX の順のまま、不明は最後）
export type PinOrder = 'file' | 'height';
export function sortPins(pins: CandidatePin[], order: PinOrder): CandidatePin[] {
  if (order === 'file') return pins;
  return pins
    .map((p, i) => ({ p, i, h: pinHeightM(p) }))
    .sort((a, b) => (a.h === null ? 1 : 0) - (b.h === null ? 1 : 0) || (b.h ?? 0) - (a.h ?? 0) || a.i - b.i)
    .map((x) => x.p);
}

// GPX の <wpt>（目印）だけを読む。<trk>・<rte>（歩いた線）は読まない
export function parseCandidateGpx(text: string): { title: string; pins: CandidatePin[] } {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length || doc.documentElement.localName !== 'gpx') throw new CandidateGpxError('GPX ではありません');
  const child = (el: Element, name: string) => Array.from(el.children).find((c) => c.localName === name)?.textContent?.trim() ?? '';
  const pins: CandidatePin[] = [];
  for (const w of Array.from(doc.documentElement.children).filter((c) => c.localName === 'wpt')) {
    const lat = Number(w.getAttribute('lat')), lng = Number(w.getAttribute('lon'));
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) continue;
    pins.push({ name: child(w, 'name') || `地点${pins.length + 1}`, desc: child(w, 'desc'), lat, lng });
  }
  if (!pins.length) throw new CandidateGpxError('目印（ウェイポイント）がありません。歩いた記録は「GPX を記録」から登録してください');
  const meta = Array.from(doc.documentElement.children).find((c) => c.localName === 'metadata');
  return { title: meta ? child(meta, 'name') : '', pins };
}

async function sha256(text: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(d)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

const DB_NAME = 'icarus-candidate-pins';
const STORE = 'sets'; // keyPath id
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
export async function closeCandidateStoreForTest(): Promise<void> {
  if (dbPromise) (await dbPromise).close();
  dbPromise = null;
}

// 読み込む。同じ中身のファイルは二重に作らない（existing = true で今の組を返す）
export async function importCandidateGpx(fileName: string, text: string): Promise<{ set: CandidateSet; existing: boolean }> {
  const { title, pins } = parseCandidateGpx(text);
  const id = await sha256(text);
  const d = await db();
  const prev = (await d.get(STORE, id)) as CandidateSet | undefined;
  if (prev) return { set: prev, existing: true };
  const set: CandidateSet = { id, fileName, title: title || fileName, importedAt: new Date().toISOString(), visible: true, pins };
  await d.put(STORE, set);
  return { set, existing: false };
}

export async function listCandidateSets(): Promise<CandidateSet[]> {
  const all = (await (await db()).getAll(STORE)) as CandidateSet[];
  return all.sort((a, b) => b.importedAt.localeCompare(a.importedAt));
}

export async function setCandidateSetVisible(id: string, visible: boolean): Promise<void> {
  const d = await db();
  const s = (await d.get(STORE, id)) as CandidateSet | undefined;
  if (s) await d.put(STORE, { ...s, visible });
}

// 利用者が明示した時だけ消す
export async function deleteCandidateSet(id: string): Promise<void> {
  await (await db()).delete(STORE, id);
}
