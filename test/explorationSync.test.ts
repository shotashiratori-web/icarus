import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { closeExplorationStoreForTest, getPending, listPending } from '../src/exploration/pendingStore';
import { clearFailure, ExplorationRejectedError, finalizeDraft, LocalGpxError, resumeAllPending, saveNewExploration, syncPending } from '../src/exploration/sync';
import { ExplorationApiError, ExplorationNetworkError } from '../src/api/explorationApi';
import { TokenExpiredError } from '../src/api/icarusApi';
import { displayStatus } from '../src/exploration/types';

// Exploration History（Stage 2 Web）: 端末の pending を正本にした 2 段送信。
// 本番 API と同じ振る舞い（hash 照合・requestId 冪等・同じ GPX は duplicate・原本が無ければ 409）の偽サーバーで確かめる

const gpx = (t = '2026-09-19T23:30:00Z', lat = 43.15) => new TextEncoder().encode(
  `<?xml version='1.0' encoding='UTF-8'?><gpx creator="YAMAP - https://yamap.com" version="1.1"><trk><name>ウォーキング</name><trkseg>` +
  `<trkpt lat="${lat}" lon="140.95"><ele>300</ele><time>${t}</time></trkpt><trkpt lat="${lat + 0.001}" lon="140.95"><ele>310</ele><time>2026-09-19T23:31:00Z</time></trkpt>` +
  `</trkseg></trk></gpx>`,
).buffer as ArrayBuffer;
const noTimeGpx = () => new TextEncoder().encode('<gpx version="1.1"><trk><trkseg><trkpt lat="43.2" lon="140.9"/><trkpt lat="43.201" lon="140.9"/></trkseg></trk></gpx>').buffer as ArrayBuffer;
const sha = async (b: ArrayBuffer | Uint8Array) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', (b instanceof Uint8Array ? b.slice().buffer : b) as ArrayBuffer))).map((x) => x.toString(16).padStart(2, '0')).join('');

// ---- 偽サーバー ----
type Mode = { put?: 'ok' | 'network' | 'mismatch' | '401' | '503'; post?: 'ok' | 'network' | 'lostResponse' | '401' | '503' | 'requestReused' | 'wrongSha' };
const server = {
  r2: new Map<string, Uint8Array>(),
  sessions: new Map<string, { id: string; requestId: string; sha: string; exploredOn: string }>(),
  calls: { put: 0, post: 0 },
  mode: {} as Mode,
  reset() { this.r2.clear(); this.sessions.clear(); this.calls = { put: 0, post: 0 }; this.mode = {}; },
};
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

async function fakeFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = String(input);
  const put = url.match(/\/exploration\/gpx\/([0-9a-f]{64})$/);
  if (put && init?.method === 'PUT') {
    server.calls.put++;
    const m = server.mode.put ?? 'ok';
    if (m === 'network') throw new TypeError('Failed to fetch');
    if (m === '401') return json(401, { code: 'AUTH' });
    if (m === '503') return new Response('bad gateway', { status: 503 });
    const body = new Uint8Array(init.body as ArrayBuffer);
    const actual = await sha(body);
    if (m === 'mismatch' || actual !== put[1]) return json(400, { code: 'GPX_HASH_MISMATCH', message: 'hash mismatch' });
    const already = server.r2.has(actual);
    server.r2.set(actual, body);
    return json(200, { sha256: actual, bytes: body.byteLength, alreadyStored: already });
  }
  if (url.endsWith('/exploration/sessions') && init?.method === 'POST') {
    server.calls.post++;
    const m = server.mode.post ?? 'ok';
    if (m === 'network') throw new TypeError('Failed to fetch');
    if (m === '401') return json(401, { code: 'AUTH' });
    if (m === '503') return new Response('', { status: 503 });
    if (m === 'requestReused') return json(409, { code: 'EXPLORATION_REQUEST_REUSED', message: 'reused' });
    const b = JSON.parse(String(init.body)) as { requestId: string; gpxSha256: string; exploredOn?: string };
    const byReq = [...server.sessions.values()].find((s) => s.requestId === b.requestId);
    const item = (s: { id: string; sha: string; exploredOn: string }) => ({ id: s.id, gpxSha256: m === 'wrongSha' ? 'f'.repeat(64) : s.sha, exploredOn: s.exploredOn });
    if (byReq) return json(200, { outcome: 'alreadyApplied', item: item(byReq) });
    if (!server.r2.has(b.gpxSha256)) return json(409, { code: 'GPX_NOT_UPLOADED', message: 'no gpx' });
    const bySha = [...server.sessions.values()].find((s) => s.sha === b.gpxSha256);
    if (bySha) return json(200, { outcome: 'duplicate', item: item(bySha) });
    const text = new TextDecoder().decode(server.r2.get(b.gpxSha256));
    const hasTime = text.includes('<time>');
    if (!hasTime && !b.exploredOn) return json(400, { code: 'EXPLORATION_NEEDS_DATE', message: 'need date' });
    const s = { id: crypto.randomUUID(), requestId: b.requestId, sha: b.gpxSha256, exploredOn: hasTime ? '2026-09-20' : b.exploredOn! };
    server.sessions.set(s.id, s);
    if (m === 'lostResponse') throw new TypeError('Failed to fetch'); // サーバーでは成立、応答だけ届かない
    return json(200, { outcome: 'applied', item: item(s) });
  }
  throw new Error(`unexpected fetch ${init?.method} ${url}`);
}

const input = (bytes = gpx()) => ({ fileName: 'yamap.gpx', bytes, explorerNames: ['翔大'], purpose: 'maitake' as const, memo: '', targets: [{ target: 'マイタケ', result: 'not_found' as const, memo: '' }] });

beforeEach(async () => {
  await closeExplorationStoreForTest();
  await new Promise<void>((r) => { const q = indexedDB.deleteDatabase('icarus-exploration'); q.onsuccess = q.onerror = q.onblocked = () => r(); });
  server.reset();
  vi.restoreAllMocks();
  vi.spyOn(globalThis, 'fetch').mockImplementation(fakeFetch);
});

describe('端末への保存（通信しない）', () => {
  it('1. 通信なしでも、まず原本を端末に保存する（無加工・SHA-256・入力内容・未送信）', async () => {
    vi.mocked(fetch).mockRejectedValue(new TypeError('offline'));
    const bytes = gpx();
    const { record, existing } = await saveNewExploration(input(bytes));
    expect(existing).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
    const saved = (await getPending(record.id))!;
    expect(new Uint8Array(saved.gpx)).toEqual(new Uint8Array(bytes));
    expect(saved.sha256).toBe(await sha(bytes));
    expect(saved).toMatchObject({ stage: 'saved', explorerNames: ['翔大'], purpose: 'maitake', preview: { exploredOn: '2026-09-20', pointCount: 2 } });
    expect(saved.targets[0]).toMatchObject({ target: 'マイタケ', result: 'not_found' });
    expect(displayStatus(saved)).toBe('unsent');
  });

  it('2. GPX でないものは保存しない。同じ GPX をもう一度選んでも 2 件目を作らない', async () => {
    await expect(saveNewExploration(input(new TextEncoder().encode('<html/>').buffer as ArrayBuffer))).rejects.toBeInstanceOf(LocalGpxError);
    expect(await listPending()).toHaveLength(0);
    const a = await saveNewExploration(input());
    const b = await saveNewExploration({ ...input(), fileName: 'copy.gpx', purpose: 'sansai' });
    expect(b).toMatchObject({ existing: true, record: { id: a.record.id } });
    expect(await listPending()).toHaveLength(1);
  });
});

describe('下書き（GPX を選んだ直後に保存）', () => {
  it('2b. 選んだ時点で原本を保存（下書き）。入力が済むまで自動送信しない。入力後は送信できる', async () => {
    const { record } = await saveNewExploration({ ...input(), explorerNames: [], purpose: 'unknown', targets: [] }, false);
    expect((await getPending(record.id))!).toMatchObject({ ready: false, stage: 'saved' });
    const send = vi.fn(async () => undefined);
    expect(await resumeAllPending('tok', send)).toBe(0);
    await expect(syncPending(record.id, 'tok')).rejects.toBeInstanceOf(ExplorationRejectedError);
    expect(server.calls.put).toBe(0);
    await finalizeDraft(record.id, { explorerNames: ['せいか'], purpose: 'mushroom', memo: '沢沿い', targets: [{ target: 'ナラタケ', result: 'found', memo: '' }] });
    const done = await syncPending(record.id, 'tok');
    expect(done).toMatchObject({ stage: 'registered', explorerNames: ['せいか'], purpose: 'mushroom', ready: true });
  });
});

describe('2 段送信', () => {
  it('3. 通信できれば ① 原本 → ② 登録 → 登録済み（応答の hash が端末と一致）', async () => {
    const { record } = await saveNewExploration(input());
    const done = await syncPending(record.id, 'tok');
    expect(done).toMatchObject({ stage: 'registered', lastError: null });
    expect(displayStatus(done)).toBe('registered');
    expect(server.calls).toEqual({ put: 1, post: 1 });
    expect(await sha(server.r2.get(record.sha256)!)).toBe(record.sha256);
    expect(server.sessions.size).toBe(1);
    expect(done.sessionId).toBe([...server.sessions.values()][0].id);
    // 登録済みの後も原本は端末に残る（自動では消さない）
    expect((await getPending(record.id))!.gpx.byteLength).toBe(record.bytes);
  });

  it('4. ① の途中で圏外 → 未送信のまま（再送できる）', async () => {
    server.mode.put = 'network';
    const { record } = await saveNewExploration(input());
    await expect(syncPending(record.id, 'tok')).rejects.toBeInstanceOf(ExplorationNetworkError);
    const p = (await getPending(record.id))!;
    expect(p).toMatchObject({ stage: 'saved', lastError: { code: 'NETWORK_ERROR', retryable: true } });
    expect(displayStatus(p)).toBe('unsent');
  });

  it('5. ① 成功 → ② の前にアプリ終了 → 再起動後は ② だけ進めて登録済み（原本を二度送らない）', async () => {
    server.mode.post = 'network';
    const { record } = await saveNewExploration(input());
    await expect(syncPending(record.id, 'tok')).rejects.toBeInstanceOf(ExplorationNetworkError);
    expect((await getPending(record.id))!.stage).toBe('gpx_uploaded');
    expect(displayStatus((await getPending(record.id))!)).toBe('gpx_uploaded');
    await closeExplorationStoreForTest(); // アプリの完全終了 → 再起動
    const restored = await listPending();
    expect(restored.map((p) => [p.id, p.stage])).toEqual([[record.id, 'gpx_uploaded']]);
    server.mode.post = 'ok';
    const done = await syncPending(record.id, 'tok');
    expect(done.stage).toBe('registered');
    expect(server.calls.put).toBe(1);
    expect(server.sessions.size).toBe(1);
  });

  it('6. ② はサーバーで成立したが応答が届かない → 再送は alreadyApplied で同じ記録（重複しない）', async () => {
    server.mode.post = 'lostResponse';
    const { record } = await saveNewExploration(input());
    await expect(syncPending(record.id, 'tok')).rejects.toBeInstanceOf(ExplorationNetworkError);
    expect((await getPending(record.id))!.stage).toBe('gpx_uploaded');
    expect(server.sessions.size).toBe(1);
    server.mode.post = 'ok';
    const done = await syncPending(record.id, 'tok');
    expect(done).toMatchObject({ stage: 'registered', sessionId: [...server.sessions.values()][0].id });
    expect(server.sessions.size).toBe(1);
  });

  it('7. 同じ GPX を別の端末（別の requestId）から → duplicate で既存の記録に結び付く', async () => {
    const { record } = await saveNewExploration(input());
    await syncPending(record.id, 'tok');
    const firstId = [...server.sessions.values()][0].id;
    // 別端末: 同じ原本・別の端末 ID
    await closeExplorationStoreForTest();
    await new Promise<void>((r) => { const q = indexedDB.deleteDatabase('icarus-exploration'); q.onsuccess = q.onerror = q.onblocked = () => r(); });
    const other = await saveNewExploration(input());
    const done = await syncPending(other.record.id, 'tok');
    expect(done).toMatchObject({ stage: 'registered', sessionId: firstId });
    expect(server.sessions.size).toBe(1);
  });

  it('8. 同じ記録の同時送信は 1 本にまとまる', async () => {
    const { record } = await saveNewExploration(input());
    await Promise.all([syncPending(record.id, 'tok'), syncPending(record.id, 'tok')]);
    expect(server.calls).toEqual({ put: 1, post: 1 });
  });
});

describe('失敗の扱い', () => {
  it('9. hash 不一致（400）→ 送信失敗。段階と原本は残り、自動再送の対象から外れる', async () => {
    server.mode.put = 'mismatch';
    const { record } = await saveNewExploration(input());
    await expect(syncPending(record.id, 'tok')).rejects.toBeInstanceOf(ExplorationRejectedError);
    const p = (await getPending(record.id))!;
    expect(p).toMatchObject({ stage: 'saved', lastError: { code: 'GPX_HASH_MISMATCH', retryable: false } });
    expect(displayStatus(p)).toBe('failed');
    expect(p.gpx.byteLength).toBe(record.bytes);
    const send = vi.fn(async () => undefined);
    expect(await resumeAllPending('tok', send)).toBe(0);
  });

  it('10. 401 → ログイン待ち（再送対象・段階は変えない）。5xx → 再送対象', async () => {
    server.mode.put = '401';
    const { record } = await saveNewExploration(input());
    await expect(syncPending(record.id, 'tok')).rejects.toBeInstanceOf(TokenExpiredError);
    expect((await getPending(record.id))!).toMatchObject({ stage: 'saved', lastError: { code: 'AUTH_EXPIRED', retryable: true } });
    server.mode.put = 'ok';
    server.mode.post = '503';
    await expect(syncPending(record.id, 'tok')).rejects.toBeInstanceOf(ExplorationApiError);
    const p = (await getPending(record.id))!;
    expect(p).toMatchObject({ stage: 'gpx_uploaded', lastError: { retryable: true } });
    expect(displayStatus(p)).toBe('gpx_uploaded');
    server.mode.post = 'ok';
    expect(await resumeAllPending('tok', (id) => syncPending(id, 'tok'))).toBe(1);
    expect((await getPending(record.id))!.stage).toBe('registered');
  });

  it('11. 409 原本未着（サーバーに原本が無い）→ ① からやり直して登録済み', async () => {
    const { record } = await saveNewExploration(input());
    server.mode.post = 'network';
    await expect(syncPending(record.id, 'tok')).rejects.toBeInstanceOf(ExplorationNetworkError);
    server.r2.clear(); // 何らかの理由でサーバー側の原本が無い
    server.mode.post = 'ok';
    const done = await syncPending(record.id, 'tok');
    expect(done.stage).toBe('registered');
    expect(server.calls.put).toBe(2);
  });

  it('12. 409 requestId の再利用・応答の hash 違い → 送信失敗（登録済みにしない）', async () => {
    const a = await saveNewExploration(input());
    server.mode.post = 'requestReused';
    await expect(syncPending(a.record.id, 'tok')).rejects.toBeInstanceOf(ExplorationRejectedError);
    expect(displayStatus((await getPending(a.record.id))!)).toBe('failed');
    const b = await saveNewExploration(input(gpx('2026-09-19T23:30:00Z', 43.3)));
    server.mode.post = 'wrongSha';
    await expect(syncPending(b.record.id, 'tok')).rejects.toBeInstanceOf(ExplorationRejectedError);
    expect((await getPending(b.record.id))!).toMatchObject({ stage: 'gpx_uploaded', lastError: { code: 'SESSION_HASH_MISMATCH', retryable: false } });
  });

  it('13. 時刻の無い GPX → 送信失敗（探索日が必要）→ 入力して送り直すと登録済み', async () => {
    const { record } = await saveNewExploration(input(noTimeGpx()));
    await expect(syncPending(record.id, 'tok')).rejects.toBeInstanceOf(ExplorationRejectedError);
    expect((await getPending(record.id))!).toMatchObject({ stage: 'gpx_uploaded', lastError: { code: 'EXPLORATION_NEEDS_DATE', retryable: false } });
    await clearFailure(record.id, { exploredOnManual: '2025-10-01' });
    const done = await syncPending(record.id, 'tok');
    expect(done.stage).toBe('registered');
    expect([...server.sessions.values()][0].exploredOn).toBe('2025-10-01');
  });

  it('14. 端末の原本が保存時と違う（壊れた）→ 送らずに送信失敗', async () => {
    const { record } = await saveNewExploration(input());
    const { updatePending } = await import('../src/exploration/pendingStore');
    await updatePending(record.id, { gpx: new TextEncoder().encode('<gpx>changed</gpx>').buffer as ArrayBuffer });
    await expect(syncPending(record.id, 'tok')).rejects.toBeInstanceOf(ExplorationRejectedError);
    expect(server.calls.put).toBe(0);
    expect((await getPending(record.id))!.lastError).toMatchObject({ code: 'LOCAL_GPX_CORRUPTED', retryable: false });
  });

  it('15. ログインしていなければ自動再送しない', async () => {
    await saveNewExploration(input());
    const send = vi.fn(async () => undefined);
    expect(await resumeAllPending(null, send)).toBe(0);
    expect(send).not.toHaveBeenCalled();
  });
});
