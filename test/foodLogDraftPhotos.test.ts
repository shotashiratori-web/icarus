import { beforeEach, describe, expect, it, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { openDB } from 'idb';
import { emptyCommonFields, emptyPhotoEntry, type PhotoEntry } from '../src/types/foodLog';

// Field Log の下書き: 入力のたびに 10 枚分の写真を書き直して固まった（2026-10-18）。
// 写真の重いデータ（縮小 JPEG・元の写真）は別の store に写真ごと 1 回だけ書き、入力では軽い内容だけを書く

async function freshLocalDB() {
  globalThis.indexedDB = new IDBFactory();
  vi.resetModules();
  return import('../src/db/localDB');
}
beforeEach(() => { globalThis.indexedDB = new IDBFactory(); });

const photo = (n: number): Omit<PhotoEntry, 'previewUrl'> => {
  const { previewUrl: _p, ...rest } = { ...emptyPhotoEntry(), base64: `small-${n}`, assetOriginalBase64: `original-${n}`, food: `食材${n}`, memo: '' };
  return rest;
};
const draftOf = (photos: Omit<PhotoEntry, 'previewUrl'>[]) => ({ photos, commonFields: emptyCommonFields(), submitMode: 'batch' as const, currentPhotoIndex: 0 });
const rawDB = () => openDB('icarus');

describe('Field Log の下書き: 写真は写真ごとに 1 回だけ書く', () => {
  it('下書きの記録には写真のデータを入れない。開き直すと写真も入力も全部戻る（10 枚）', async () => {
    const { saveFoodLogDraft, loadFoodLogDraft } = await freshLocalDB();
    const photos = Array.from({ length: 10 }, (_, i) => photo(i));
    await saveFoodLogDraft(draftOf(photos));
    for (let i = 0; i < 10; i++) photos[i] = { ...photos[i], memo: `メモ${i}` };
    await saveFoodLogDraft(draftOf(photos));

    const db = await rawDB();
    const rec = await db.get('food_log_draft', 'current');
    expect(rec.photos.every((p: PhotoEntry) => p.base64 === '' && p.assetOriginalBase64 === undefined)).toBe(true);
    expect(await db.count('food_log_draft_photos')).toBe(10);
    db.close();

    const { loadFoodLogDraft: loadAgain } = await import('../src/db/localDB');
    const back = await loadAgain();
    expect(back?.photos.map((p) => [p.base64, p.assetOriginalBase64, p.memo])).toEqual(photos.map((_p, i) => [`small-${i}`, `original-${i}`, `メモ${i}`]));
    expect(loadFoodLogDraft).toBe(loadAgain);
  });

  it('入力を変えても、写真のデータは書き直さない', async () => {
    const { saveFoodLogDraft, loadFoodLogDraft } = await freshLocalDB();
    const p = photo(1);
    await saveFoodLogDraft(draftOf([p]));
    // 同じ写真（localId）で中身だけ違う値を渡しても、最初に書いた写真のデータのまま＝書き直していない
    await saveFoodLogDraft(draftOf([{ ...p, memo: '太い', base64: 'changed', assetOriginalBase64: 'changed' }]));
    const back = await loadFoodLogDraft();
    expect(back?.photos[0]).toMatchObject({ memo: '太い', base64: 'small-1', assetOriginalBase64: 'original-1' });
  });

  it('外した写真のデータは消す', async () => {
    const { saveFoodLogDraft } = await freshLocalDB();
    const a = photo(1), b = photo(2);
    await saveFoodLogDraft(draftOf([a, b]));
    await saveFoodLogDraft(draftOf([b]));
    const db = await rawDB();
    expect(await db.getAllKeys('food_log_draft_photos')).toEqual([b.localId]);
    db.close();
  });

  it('前の版の下書き（写真のデータが中に入っている）もそのまま読める', async () => {
    const { loadFoodLogDraft } = await freshLocalDB();
    await loadFoodLogDraft(); // store を作る
    const db = await rawDB();
    const old = photo(7);
    await db.put('food_log_draft', { ...draftOf([old]), id: 'current', savedAt: '2026-10-01T00:00:00Z' });
    db.close();
    const back = await loadFoodLogDraft();
    expect(back?.photos[0]).toMatchObject({ base64: 'small-7', assetOriginalBase64: 'original-7' });
  });

  it('破棄すると写真のデータも消える', async () => {
    const { saveFoodLogDraft, clearFoodLogDraft, loadFoodLogDraft } = await freshLocalDB();
    await saveFoodLogDraft(draftOf([photo(1), photo(2)]));
    await clearFoodLogDraft();
    expect(await loadFoodLogDraft()).toBeUndefined();
    const db = await rawDB();
    expect(await db.count('food_log_draft_photos')).toBe(0);
    db.close();
    // 破棄のあとに同じ写真を入れ直しても、また書かれる
    const p = photo(3);
    await saveFoodLogDraft(draftOf([p]));
    expect((await loadFoodLogDraft())?.photos[0].base64).toBe('small-3');
  });
});
