import { beforeEach, describe, expect, it, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';

// Work Log Draft Identity Fix。旧設計は work_log_draft のkeyが固定文字列'create'または
// `append:${workId}`の単一スロットだったため、同一mode/workIdに対して複数のpending attempt
// （例: create A失敗中にcreate Bを開始、同一workへのappend A/Bが同時保留）が存在すると、
// 後発のautosaveが先発のdraftを上書きし、queueがそれを参照していた場合はデータが混線する
// おそれがあった。修正後はkeyを`work:${requestId}`のみで導出し、requestIdを唯一のidentityとする。
//
// vi.resetModules()でlocalDB.tsのモジュールスコープ内singleton（_db）を毎回作り直しつつ、
// globalThis.indexedDBも毎回新しいIDBFactoryへ差し替えることで、テストごとに完全に独立した
// IndexedDB状態を用意する（fake-indexeddbはprocess内でデータを保持し続けるため、使い回すと
// テスト間でdraftが汚染される）。

async function freshLocalDB() {
  globalThis.indexedDB = new IDBFactory();
  vi.resetModules();
  return import('../src/db/localDB');
}

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
});

describe('work_log_draft: requestId identity', () => {
  it('create Aのdraftは、別のrequestId(create B)からは見えない（衝突しない）', async () => {
    const { saveWorkLogDraft, loadWorkLogDraft } = await freshLocalDB();
    await saveWorkLogDraft({
      requestId: 'req-a', mode: 'create', title: 'A', type: '加工研究',
      content: 'Aの内容', datetime: '2026-09-12T10:00',
    });

    const draftForB = await loadWorkLogDraft('req-b');
    expect(draftForB).toBeUndefined();

    const draftForA = await loadWorkLogDraft('req-a');
    expect(draftForA?.title).toBe('A');
  });

  it('create A/Bのdraftが同時に存在できる', async () => {
    const { saveWorkLogDraft, loadWorkLogDraft } = await freshLocalDB();
    await saveWorkLogDraft({ requestId: 'req-a', mode: 'create', title: 'A', content: 'content-a', datetime: '2026-09-12T10:00' });
    await saveWorkLogDraft({ requestId: 'req-b', mode: 'create', title: 'B', content: 'content-b', datetime: '2026-09-12T11:00' });

    expect((await loadWorkLogDraft('req-a'))?.title).toBe('A');
    expect((await loadWorkLogDraft('req-b'))?.title).toBe('B');
  });

  it('同一workIdへのappend A/Bが同時に存在できる（旧key方式append:${workId}では不可能だった）', async () => {
    const { saveWorkLogDraft, loadWorkLogDraft } = await freshLocalDB();
    const workId = '20260912-001';
    await saveWorkLogDraft({ requestId: 'req-append-a', mode: 'append', workId, content: '作業メモA', datetime: '2026-09-12T10:00' });
    await saveWorkLogDraft({ requestId: 'req-append-b', mode: 'append', workId, content: '作業メモB', datetime: '2026-09-12T11:00' });

    expect((await loadWorkLogDraft('req-append-a'))?.content).toBe('作業メモA');
    expect((await loadWorkLogDraft('req-append-b'))?.content).toBe('作業メモB');
  });

  it('requestIdごとに正しいdraftを取得できる（keyは`work:${requestId}`から導出される）', async () => {
    const { saveWorkLogDraft, loadWorkLogDraft, workLogDraftKey } = await freshLocalDB();
    expect(workLogDraftKey('req-x')).toBe('work:req-x');

    await saveWorkLogDraft({ requestId: 'req-x', mode: 'create', title: 'X', content: 'c', datetime: '2026-09-12T10:00' });
    const loaded = await loadWorkLogDraft('req-x');
    expect(loaded?.requestId).toBe('req-x');
    expect(loaded?.key).toBe('work:req-x');
  });

  it('一方をclearしても他方は残る', async () => {
    const { saveWorkLogDraft, loadWorkLogDraft, clearWorkLogDraft } = await freshLocalDB();
    await saveWorkLogDraft({ requestId: 'req-a', mode: 'create', title: 'A', content: 'a', datetime: '2026-09-12T10:00' });
    await saveWorkLogDraft({ requestId: 'req-b', mode: 'create', title: 'B', content: 'b', datetime: '2026-09-12T10:00' });

    await clearWorkLogDraft('req-a');

    expect(await loadWorkLogDraft('req-a')).toBeUndefined();
    expect((await loadWorkLogDraft('req-b'))?.title).toBe('B');
  });

  it('写真Base64が別draftへ混線しない', async () => {
    const { saveWorkLogDraft, loadWorkLogDraft } = await freshLocalDB();
    await saveWorkLogDraft({
      requestId: 'req-a', mode: 'create', title: 'A', content: 'a', datetime: '2026-09-12T10:00',
      photoBase64: 'BASE64_A', photoMimeType: 'image/jpeg',
    });
    await saveWorkLogDraft({ requestId: 'req-b', mode: 'create', title: 'B', content: 'b', datetime: '2026-09-12T10:00' });

    expect((await loadWorkLogDraft('req-a'))?.photoBase64).toBe('BASE64_A');
    expect((await loadWorkLogDraft('req-b'))?.photoBase64).toBeUndefined();
  });
});

describe('work_log_draft: legacy key migration', () => {
  it('旧key方式（createの固定キー）のdraftを、起動時に新key（work:${requestId}）へ一度だけ移行する', async () => {
    // 既存端末を模す: まずlocalDB.tsにstoreを作らせてから接続を閉じ、
    // 旧バージョンのアプリが書き込んだ形のレコードを直接put()する
    const bootstrapDB = await freshLocalDB();
    const bootstrapConn = await bootstrapDB.getDB();
    bootstrapConn.close();

    const { openDB } = await import('idb');
    const raw = await openDB('icarus');
    await raw.put('work_log_draft', {
      key: 'create',
      requestId: 'legacy-req-1',
      mode: 'create',
      title: '旧下書き',
      type: '加工研究',
      content: '移行前の内容',
      datetime: '2026-09-01T09:00',
      photoCaption: '', // 旧フィールド名が残っていても移行が壊れないことも兼ねて確認する
      savedAt: '2026-09-01T09:00:00.000Z',
    });
    raw.close();

    // アプリを再起動した想定でモジュールを作り直す（物理DBはそのまま=globalThis.indexedDBは維持）
    vi.resetModules();
    const localDB2 = await import('../src/db/localDB');

    const migrated = await localDB2.loadWorkLogDraft('legacy-req-1');
    expect(migrated).toBeDefined();
    expect(migrated?.content).toBe('移行前の内容');
    expect(migrated?.key).toBe('work:legacy-req-1');

    // 旧keyではもう見つからない
    const raw2 = await openDB('icarus');
    const oldKeyRecord = await raw2.get('work_log_draft', 'create');
    expect(oldKeyRecord).toBeUndefined();
    raw2.close();
  });

  it('新形式（work:プレフィックス）のdraftは移行対象にならず、そのまま残る', async () => {
    const { saveWorkLogDraft } = await freshLocalDB();
    await saveWorkLogDraft({ requestId: 'already-new', mode: 'create', content: 'x', datetime: '2026-09-12T10:00' });

    vi.resetModules();
    const localDB2 = await import('../src/db/localDB');
    const draft = await localDB2.loadWorkLogDraft('already-new');
    expect(draft?.content).toBe('x');
  });
});
