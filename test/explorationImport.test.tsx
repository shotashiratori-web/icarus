import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { mockUseAuth } from './testAuth';
import { AREA_OUTSIDE_NOTE, planImport, summarize } from '../src/exploration/importPlan';

// 過去 YAMAP GPX の一括取り込み（Exploration History、設計 §5・§15）: 送信前の確認一覧と、1 件ずつの登録と同じ経路

const AREA = { areaId: 'yoichi-akaigawa', south: 43.02, north: 43.26, west: 140.62, east: 141.08 };
const enc = (s: string) => new TextEncoder().encode(s).buffer as ArrayBuffer;
const gpx = (lat: number, lon: number, t0: string, t1: string) => enc(
  `<gpx creator="YAMAP - https://yamap.com" version="1.1"><trk><name>ウォーキング</name><trkseg>` +
  `<trkpt lat="${lat}" lon="${lon}"><time>${t0}</time></trkpt><trkpt lat="${lat + 0.002}" lon="${lon}"><time>${t1}</time></trkpt></trkseg></trk></gpx>`,
);
const inside1 = gpx(43.15, 140.95, '2026-07-28T02:47:00Z', '2026-07-28T02:55:00Z');
const inside2 = gpx(43.10, 140.90, '2026-09-21T03:50:00Z', '2026-09-21T04:07:00Z');
const outside = gpx(43.30, 141.30, '2026-08-03T01:06:00Z', '2026-08-03T01:29:00Z');
const nearCopy = gpx(43.1501, 140.95, '2026-07-28T02:48:00Z', '2026-07-28T02:56:00Z'); // 再書き出し（バイト違い・時刻がほぼ同じ）
const registered = gpx(43.2, 140.8, '2026-09-26T06:24:00Z', '2026-09-26T08:22:00Z');
const sha = async (b: ArrayBuffer) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', b))).map((x) => x.toString(16).padStart(2, '0')).join('');

describe('planImport / summarize', () => {
  it('1. 取り込む・登録済み・端末にあり・同じファイル・読めない・範囲外・重複の可能性を見分けて集計する', async () => {
    const regSha = await sha(registered);
    const devSha = await sha(inside2);
    const rows = await planImport([
      { fileName: 'a.gpx', bytes: inside1 },
      { fileName: 'b.gpx', bytes: inside2 },
      { fileName: 'c.gpx', bytes: outside },
      { fileName: 'a-copy.gpx', bytes: inside1 },
      { fileName: 'a-reexport.gpx', bytes: nearCopy },
      { fileName: 'r.gpx', bytes: registered },
      { fileName: 'x.gpx', bytes: enc('<html/>') },
    ], [AREA], {
      server: async (s) => (s === regSha ? 'session-9-26' : null),
      device: async (s) => s === devSha,
    });
    const by = Object.fromEntries(rows.map((r) => [r.fileName, r]));
    expect(by['a.gpx']).toMatchObject({ state: 'new', areaIds: ['yoichi-akaigawa'] });
    expect(by['c.gpx']).toMatchObject({ state: 'new', areaIds: [] });
    expect(by['a-copy.gpx'].state).toBe('sameFile');
    expect(by['b.gpx'].state).toBe('device');
    expect(by['r.gpx']).toMatchObject({ state: 'server', serverSessionId: 'session-9-26' });
    expect(by['x.gpx'].state).toBe('invalid');
    expect(by['a-reexport.gpx'].nearDuplicateOf).toContain('a.gpx');
    const s = summarize(rows);
    expect(s).toMatchObject({ total: 7, toImport: 3, server: 1, device: 1, sameFile: 1, invalid: 1, inside: 2, outside: 1, oldest: '2026-07-28', newest: '2026-08-03' });
    expect(s.nearDuplicates).toBe(2); // a.gpx と a-reexport.gpx（自動では除かない）
  });
});

// ---- 画面 ----
const auth = vi.hoisted(() => ({ role: 'admin' as 'admin' | 'staff' }));
vi.mock('../src/context/AuthContext', () => ({
  useAuth: () => mockUseAuth({ staffMe: { email: 'a@test.invalid', displayName: '翔大', role: auth.role, staffStatus: 'active' } }),
}));
vi.mock('../src/api/terrainApi', async (orig) => ({
  ...(await orig<typeof import('../src/api/terrainApi')>()),
  fetchTerrainAreas: vi.fn(async () => [{ areaId: AREA.areaId, name: '', version: 'v', totalBytes: 1, bounds: { south: AREA.south, north: AREA.north, west: AREA.west, east: AREA.east } }]),
}));
const api = vi.hoisted(() => ({ getGpxStatus: vi.fn() }));
vi.mock('../src/api/explorationApi', async (orig) => ({ ...(await orig<typeof import('../src/api/explorationApi')>()), getGpxStatus: api.getGpxStatus }));
const submit = vi.hoisted(() => ({ submitExploration: vi.fn(async () => true) }));
vi.mock('../src/exploration/submit', () => submit);

const { default: ExplorationImportScreen } = await import('../src/screens/ExplorationImportScreen');
const { listPending, closeExplorationStoreForTest } = await import('../src/exploration/pendingStore');

describe('ExplorationImportScreen', () => {
  beforeEach(async () => {
    auth.role = 'admin';
    await closeExplorationStoreForTest();
    await new Promise<void>((r) => { const q = indexedDB.deleteDatabase('icarus-exploration'); q.onsuccess = q.onerror = q.onblocked = () => r(); });
    api.getGpxStatus.mockReset().mockResolvedValue({ stored: false, bytes: null, sessionId: null });
    submit.submitExploration.mockClear();
  });

  it('2. 確認一覧に範囲外の説明を出し、確認のあと 1 件ずつ端末に保存して送る（source=yamap_import・同じ取り込みの回・目的=不明・対象=空）', async () => {
    render(<ExplorationImportScreen go={vi.fn()} />);
    const input = document.querySelector('input[type=file]') as HTMLInputElement;
    const files = [new File([inside1], 'yamap_2026-07-28_11_47.gpx'), new File([outside], 'yamap_2026-08-03_10_06.gpx')];
    fireEvent.change(input, { target: { files } });
    expect(await screen.findByText(AREA_OUTSIDE_NOTE)).toBeInTheDocument();
    expect(screen.getByText('取り込む 2 件')).toBeInTheDocument();
    expect(screen.getByText(/範囲内 1 件・範囲外 1 件/)).toBeInTheDocument();
    // 歩いた人が空の間は取り込めない（必須）
    expect(screen.getByRole('button', { name: '2 件を取り込む' })).toBeDisabled();
    expect(screen.getByText('歩いた人を入力してください（入力するまで取り込めません）')).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText('例: 翔大'), { target: { value: '翔大' } });
    fireEvent.click(screen.getByRole('button', { name: '2 件を取り込む' }));
    expect(submit.submitExploration).not.toHaveBeenCalled(); // まだ確認画面
    expect(screen.getByRole('status')).toHaveTextContent('取り込む 2 件'); // 件数を大きく
    const confirmBtns = screen.getAllByRole('button', { name: '2 件を取り込む' });
    fireEvent.click(confirmBtns[confirmBtns.length - 1]);
    await waitFor(() => expect(submit.submitExploration).toHaveBeenCalledTimes(2));
    const saved = await listPending();
    expect(saved).toHaveLength(2);
    expect(new Set(saved.map((p) => p.importBatchId)).size).toBe(1);
    for (const p of saved) {
      expect(p).toMatchObject({ source: 'yamap_import', ready: true, purpose: 'unknown', targets: [], explorerNames: ['翔大'], stage: 'saved' });
    }
    // 取り込んだ後は計画を作り直す: サーバーに登録済み（ここではモックで登録済みとして返す）→ 取り込む 0 件
    api.getGpxStatus.mockResolvedValue({ stored: true, bytes: 1, sessionId: 'now-registered' });
    await waitFor(() => expect(screen.getByRole('button', { name: '0 件を取り込む' })).toBeDisabled(), { timeout: 3000 });
  });

  it('2b. 同じファイルを選び直しても読み直す（選択欄を読み取り後に空に戻す）', async () => {
    render(<ExplorationImportScreen go={vi.fn()} />);
    const input = document.querySelector('input[type=file]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File([inside1], 'a.gpx')] } });
    expect(await screen.findByText('取り込む 1 件')).toBeInTheDocument();
    await waitFor(() => expect(input.value).toBe(''));
    api.getGpxStatus.mockResolvedValue({ stored: true, bytes: 1, sessionId: 'x' });
    fireEvent.change(input, { target: { files: [new File([inside1], 'a.gpx')] } });
    expect(await screen.findByText('取り込む 0 件')).toBeInTheDocument();
  });

  it('3. サーバーに登録済みの GPX はスキップ（取り込む 0 件なら取り込めない）', async () => {
    api.getGpxStatus.mockResolvedValue({ stored: true, bytes: 1, sessionId: 'existing' });
    render(<ExplorationImportScreen go={vi.fn()} />);
    fireEvent.change(document.querySelector('input[type=file]') as HTMLInputElement, { target: { files: [new File([inside1], 'a.gpx')] } });
    expect(await screen.findByText('登録済み（スキップ）')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '0 件を取り込む' })).toBeDisabled();
  });

  it('4. staff には使えない', () => {
    auth.role = 'staff';
    render(<ExplorationImportScreen go={vi.fn()} />);
    expect(screen.getByText('管理者のみ利用できます。')).toBeInTheDocument();
    expect(document.querySelector('input[type=file]')).toBeNull();
  });
});
