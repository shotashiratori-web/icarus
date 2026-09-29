import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { closeSpotStoreForTest, getPendingSpot, getPendingObservation } from '../src/environmentSpots/store';
import { photoFromFile, saveNewObservation, saveNewSpot, syncObservation, syncSpot, SpotRejectedError } from '../src/environmentSpots/sync';
import type { PendingSpot } from '../src/environmentSpots/types';

// Environment Spots の端末保存と送信（S3 §3-2・§7-5）: 写真の原本は登録が済むまで端末に残す。
// saved →（写真: POST /assets → R2 PUT → finalize）→ photos_uploaded →（POST /environment-spots、冪等）→ registered

const body = (extra: Partial<PendingSpot['body']> = {}): PendingSpot['body'] => ({
  envType: 'tree', lifeState: 'alive', treeSpeciesId: 'tree-mizunara', lat: 43.1154, lng: 140.669, locationSource: 'gps', gpsAccuracyM: 8,
  memo: '', observedAt: '2026-09-29T09:12:00+09:00', terrain: { terrainVersion: 'v' }, ...extra,
});
const jpeg = () => new File([new Uint8Array([0xff, 0xd8, 0xff, 1, 2, 3])], 'IMG_0001.JPG', { type: 'image/jpeg' });

type Call = { url: string; method: string; body: unknown };
function server(opts: { failSpotOnce?: boolean; spotStatus?: number } = {}) {
  const calls: Call[] = [];
  let spotFails = opts.failSpotOnce ? 1 : 0;
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    let parsed: unknown = null;
    try { parsed = init?.body && typeof init.body === 'string' ? JSON.parse(init.body) : null; } catch { parsed = null; }
    calls.push({ url, method, body: parsed });
    if (url.endsWith('/assets') && method === 'POST') return new Response(JSON.stringify({ assetId: `asset-${calls.length}`, assetStatus: 'pending', uploadRequired: true, presignedUploadUrl: 'https://r2.example/put' }));
    if (url === 'https://r2.example/put') return new Response('', { status: 200 });
    if (url.includes('/finalize')) return new Response(JSON.stringify({ assetStatus: 'ready' }));
    if (url.endsWith('/environment-spots') && method === 'POST') {
      if (spotFails > 0) { spotFails--; throw new TypeError('offline'); }
      if (opts.spotStatus) return new Response(JSON.stringify({ status: 'error', code: 'SPOT_VALIDATION', message: '樹種を選んでください' }), { status: opts.spotStatus });
      return new Response(JSON.stringify({ outcome: 'applied', item: { id: 'spot-1' } }), { status: 201 });
    }
    if (url.endsWith('/observations') && method === 'POST') return new Response(JSON.stringify({ outcome: 'applied', item: { id: 'obs-1' } }), { status: 201 });
    return new Response('{}', { status: 404 });
  });
  return calls;
}

describe('environment spots sync', () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    await closeSpotStoreForTest();
    await new Promise<void>((r) => { const q = indexedDB.deleteDatabase('icarus-environment-spots'); q.onsuccess = q.onerror = q.onblocked = () => r(); });
  });

  it('1. 写真か「写真なしの理由」が無いと端末にも保存しない。写真は原本（ArrayBuffer）で保存', async () => {
    await expect(saveNewSpot(body(), [])).rejects.toBeInstanceOf(SpotRejectedError);
    const ph = await photoFromFile(jpeg());
    const p = await saveNewSpot(body(), [ph]);
    const stored = await getPendingSpot(p.id);
    expect(stored?.stage).toBe('saved');
    expect(stored?.photos[0].data?.byteLength).toBe(6);
    expect(stored?.photos[0].sha256).toMatch(/^[0-9a-f]{64}$/);
    await expect(photoFromFile(new File(['x'], 'a.png', { type: 'image/png' }))).rejects.toThrow('JPEG');
    const noPhoto = await saveNewSpot(body({ photoMissingReason: 'danger' }), []);
    expect((await getPendingSpot(noPhoto.id))?.photos).toEqual([]);
  });

  it('2. 写真 → R2 → finalize → 登録。登録が済んだら写真の原本を端末から外す', async () => {
    const calls = server();
    const p = await saveNewSpot(body(), [await photoFromFile(jpeg())]);
    const done = await syncSpot(p.id, 'tok');
    expect(done.stage).toBe('registered');
    expect(done.spotId).toBe('spot-1');
    expect(done.photos[0].data).toBeNull();
    const reg = calls.find((c) => c.url.endsWith('/environment-spots'))!;
    expect(reg.body).toMatchObject({ requestId: p.id, photoAssetIds: ['asset-1'], treeSpeciesId: 'tree-mizunara', locationSource: 'gps' });
    expect(calls.map((c) => `${c.method} ${c.url.replace(/^https:\/\/[^/]+/, '')}`)).toEqual(['POST /assets', 'PUT /put', 'POST /assets/asset-1/finalize', 'POST /environment-spots']);
  });

  it('3. 登録の途中で圏外 → 写真は送信済み・原本は残る → 再開すると写真を送り直さずに登録', async () => {
    const calls = server({ failSpotOnce: true });
    const p = await saveNewSpot(body(), [await photoFromFile(jpeg())]);
    await expect(syncSpot(p.id, 'tok')).rejects.toThrow();
    const mid = (await getPendingSpot(p.id))!;
    expect(mid.stage).toBe('photos_uploaded');
    expect(mid.photos[0].assetId).toBe('asset-1');
    expect(mid.photos[0].data?.byteLength).toBe(6); // まだ登録前なので原本を持っている
    expect(mid.lastError?.retryable).toBe(true);
    const done = await syncSpot(p.id, 'tok');
    expect(done.stage).toBe('registered');
    expect(calls.filter((c) => c.url.endsWith('/assets')).length).toBe(1); // 写真は 1 回だけ
  });

  it('4. サーバーが断った（400）は再送しない印を付ける', async () => {
    server({ spotStatus: 400 });
    const p = await saveNewSpot(body({ photoMissingReason: 'dark' }), []);
    await expect(syncSpot(p.id, 'tok')).rejects.toBeInstanceOf(SpotRejectedError);
    expect((await getPendingSpot(p.id))?.lastError).toMatchObject({ code: 'SPOT_VALIDATION', retryable: false });
  });

  it('5. まだ登録していないスポットへの観察は、先にスポットを送ってから送る。対象が無ければ保存しない', async () => {
    const calls = server();
    const p = await saveNewSpot(body({ photoMissingReason: 'dark' }), []);
    await expect(saveNewObservation({ spotId: null, pendingSpotId: p.id }, { observedAt: '2026-10-01T10:00:00+09:00', result: 'not_found', memo: '' })).rejects.toBeInstanceOf(SpotRejectedError);
    const o = await saveNewObservation({ spotId: null, pendingSpotId: p.id }, { observedAt: '2026-10-01T10:00:00+09:00', targetSpeciesId: 'target-maitake', result: 'not_found', memo: '' });
    const done = await syncObservation(o.id, 'tok');
    expect(done).toMatchObject({ stage: 'registered', spotId: 'spot-1', observationId: 'obs-1' });
    expect(calls.map((c) => c.url.replace(/^https:\/\/[^/]+/, ''))).toEqual(['/environment-spots', '/environment-spots/spot-1/observations']);
    expect(calls[1].body).toMatchObject({ requestId: o.id, targetSpeciesId: 'target-maitake', result: 'not_found' });
    expect((await getPendingObservation(o.id))?.stage).toBe('registered');
  });
});
