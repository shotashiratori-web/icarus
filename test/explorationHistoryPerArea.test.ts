import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { closeExplorationStoreForTest, listRemoteSessions, saveRemoteSessions } from '../src/exploration/pendingStore';
import type { ExplorationSession } from '../src/exploration/types';

// 探索履歴の圏外用の写しは山域ごとに入れ替える（2026-10-06）。
// 以前は全部消してから入れていたため、電波のある所でニセコ（0 件）を開くと余市の写しが消え、圏外で余市の履歴が出なくなった

const s = (id: string, areaIds: string[]): ExplorationSession => ({
  id, gpxSha256: id, gpxBytes: 1, gpxTrackName: id, exploredOn: '2026-09-21', startedAt: null, endedAt: null, durationS: null, distanceM: 1,
  bbox: { south: 43.1, north: 43.2, west: 140.8, east: 140.9 }, areaIds, explorerNames: [], purpose: 'mushroom', memo: '', source: 'web',
  status: 'active', createdByName: '', updatedAt: '2026-09-21T00:00:00Z', targets: [], fieldLogEventIds: [],
});

describe('探索履歴の写し（山域ごと）', () => {
  beforeEach(async () => {
    await closeExplorationStoreForTest();
    await new Promise<void>((r) => { const q = indexedDB.deleteDatabase('icarus-exploration'); q.onsuccess = q.onerror = q.onblocked = () => r(); });
  });

  it('1. ニセコ（0 件）を取り直しても、余市の写しは消えない', async () => {
    await saveRemoteSessions([s('a', ['yoichi-akaigawa']), s('b', ['yoichi-akaigawa'])], '2026-10-06T00:00:00Z', 'yoichi-akaigawa');
    await saveRemoteSessions([], '2026-10-06T01:00:00Z', 'niseko-yotei');
    const y = await listRemoteSessions('yoichi-akaigawa');
    expect(y.items.map((x) => x.id).sort()).toEqual(['a', 'b']);
    expect(y.syncedAt).toBe('2026-10-06T00:00:00Z');
    const n = await listRemoteSessions('niseko-yotei');
    expect(n.items).toEqual([]);
    expect(n.syncedAt).toBe('2026-10-06T01:00:00Z');
  });

  it('2. 山域の写しは、その山域の分だけ入れ替わる（消えた記録は消える）', async () => {
    await saveRemoteSessions([s('a', ['yoichi-akaigawa']), s('n', ['niseko-yotei'])], 't0', 'yoichi-akaigawa');
    await saveRemoteSessions([s('b', ['yoichi-akaigawa'])], 't1', 'yoichi-akaigawa');
    expect((await listRemoteSessions('yoichi-akaigawa')).items.map((x) => x.id)).toEqual(['b']);
    expect((await listRemoteSessions('niseko-yotei')).items.map((x) => x.id)).toEqual(['n']);
  });

  it('3. 両方の山域にかかる記録（北緯 43.02〜43.03 の重なり）はどちらにも出る', async () => {
    await saveRemoteSessions([s('both', ['yoichi-akaigawa', 'niseko-yotei'])], 't0', 'yoichi-akaigawa');
    await saveRemoteSessions([s('both', ['yoichi-akaigawa', 'niseko-yotei'])], 't1', 'niseko-yotei');
    expect((await listRemoteSessions('yoichi-akaigawa')).items.map((x) => x.id)).toEqual(['both']);
    expect((await listRemoteSessions('niseko-yotei')).items.map((x) => x.id)).toEqual(['both']);
  });
});
