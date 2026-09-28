import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SubmissionItem } from '../src/submission/types';

// Exploration History（Stage 2 Web）: 送信の予約は Submission Framework に載る（キューには ID だけ、GPX 原本は入れない）。
// 圏外で登録 → 保留（Home の未送信に出る）→ オンライン復帰の resendAll で自動的に登録済みへ

const queue = vi.hoisted(() => {
  const m = new Map<string, unknown>();
  return {
    m,
    listAll: vi.fn(async () => [...m.values()]),
    get: vi.fn(async (id: string) => m.get(id)),
    put: vi.fn(async (item: { id: string }) => { m.set(item.id, item); }),
    remove: vi.fn(async (id: string) => { m.delete(id); }),
  };
});
vi.mock('../src/submission/queueDB', () => ({ listAll: queue.listAll, get: queue.get, put: queue.put, remove: queue.remove }));

const gpx = () => new TextEncoder().encode(
  `<gpx version="1.1"><trk><trkseg><trkpt lat="43.15" lon="140.95"><time>2026-09-19T23:30:00Z</time></trkpt><trkpt lat="43.151" lon="140.95"><time>2026-09-19T23:31:00Z</time></trkpt></trkseg></trk></gpx>`,
).buffer as ArrayBuffer;

let online = false;
const sessions: string[] = [];
beforeEach(() => {
  queue.m.clear();
  sessions.length = 0;
  online = false;
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    if (!online) throw new TypeError('Failed to fetch');
    const url = String(input);
    if (init?.method === 'PUT') return new Response(JSON.stringify({ alreadyStored: false }), { status: 200 });
    if (url.endsWith('/exploration/sessions')) {
      const b = JSON.parse(String(init?.body)) as { requestId: string; gpxSha256: string };
      if (!sessions.includes(b.requestId)) sessions.push(b.requestId);
      return new Response(JSON.stringify({ outcome: 'applied', item: { id: `s-${b.requestId}`, gpxSha256: b.gpxSha256 } }), { status: 200 });
    }
    throw new Error('unexpected');
  });
});

describe('Submission Framework との接続', () => {
  it('圏外で登録 → 保留（ID だけ・原本なし）→ オンライン復帰の resendAll で登録済み・保留が消える', async () => {
    await import('../src/submission/adapters');
    const { saveNewExploration } = await import('../src/exploration/sync');
    const { submitExploration } = await import('../src/exploration/submit');
    const { resendAll } = await import('../src/submission/orchestrator');
    const { getPending } = await import('../src/exploration/pendingStore');

    const { record } = await saveNewExploration({ fileName: 'a.gpx', bytes: gpx(), explorerNames: [], purpose: 'maitake', memo: '', targets: [] });
    expect(await submitExploration(record.id, 'tok')).toBe(false);
    const item = queue.m.get(record.id) as SubmissionItem<{ pendingId: string }>;
    expect(item).toMatchObject({ entity: 'explorationSession', state: 'pending', payload: { pendingId: record.id }, lastError: { code: 'NETWORK_ERROR', retryable: true } });
    expect(JSON.stringify(item).length).toBeLessThan(2000); // 原本は入っていない

    online = true;
    await resendAll('tok');
    expect(queue.m.has(record.id)).toBe(false);
    expect((await getPending(record.id))!.stage).toBe('registered');
    expect(sessions).toEqual([record.id]);
  });
});
