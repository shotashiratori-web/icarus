import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { mockUseAuth } from './testAuth';
import type { FieldLogEntry } from '../src/types/zukan';

// Field Log の物理削除を無効化へ置き換え（icarus_field_log_void_design.md §9）。
// 一括写真整理の「対象外」と、地図の重複の「選択して…」は、どちらも削除ではなく無効化（理由つき・戻せる）

vi.mock('../src/context/AuthContext', () => ({ useAuth: () => mockUseAuth() }));
vi.mock('../src/components/FieldGpsMiniMap', () => ({ default: () => null }));
vi.mock('../src/components/terrain/ExplorationMap', () => ({ default: () => null }));

const api = vi.hoisted(() => ({
  fetchFieldEntryDetail: vi.fn(),
  voidFieldEntryLatest: vi.fn(),
  saveFieldEntryChanges: vi.fn(),
}));
vi.mock('../src/api/fieldEntryEditApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/api/fieldEntryEditApi')>()),
  ...api,
}));
const zukan = vi.hoisted(() => ({ fetchFieldLogEntries: vi.fn() }));
vi.mock('../src/api/zukanApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/api/zukanApi')>()),
  classifyFieldPhoto: vi.fn().mockResolvedValue({ isFieldSubject: true, reason: '' }),
  fetchFieldLogEntries: zukan.fetchFieldLogEntries,
}));

vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
const memory = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (k: string) => memory.get(k) ?? null,
  setItem: (k: string, v: string) => { memory.set(k, String(v)); },
  removeItem: (k: string) => { memory.delete(k); },
  clear: () => memory.clear(),
  key: (i: number) => [...memory.keys()][i] ?? null,
  get length() { return memory.size; },
});

const { useZukanFieldStore } = await import('../src/store/zukanFieldStore');
const { default: FieldBulkOrganizeScreen } = await import('../src/screens/FieldBulkOrganizeScreen');
const { default: ZukanFieldMapScreen } = await import('../src/screens/ZukanFieldMapScreen');

const mk = (eventId: string, over: Partial<FieldLogEntry> = {}): FieldLogEntry => ({
  id: eventId, foodName: '', place: '', date: '2026-09-26', memo: '', photoUrl: '', notionUrl: '', elevation: null, kigo: '',
  lat: 43.1, lng: 140.86, recordedAt: '2026-09-28T12:00:00+09:00', eventId, takenAt: '2026-09-26T12:13:06+09:00', ...over,
});

beforeEach(() => {
  memory.clear();
  Element.prototype.scrollTo = vi.fn();
  api.fetchFieldEntryDetail.mockReset().mockImplementation(async (id: string) => ({ eventId: id, food: '', place: '', memo: '', date: '2026-09-26', kigo: '', updatedAt: `t-${id}` }));
  api.voidFieldEntryLatest.mockReset();
});

describe('一括写真整理: 対象外は無効化', () => {
  it('1. 「削除」の文言は無く、既定の理由で無効化する。理由を消すと押せない', async () => {
    useZukanFieldStore.setState({ entries: [mk('e1')], loadState: 'ready', errorMessage: '' });
    render(<FieldBulkOrganizeScreen go={vi.fn()} from={{ name: 'field' } as never} />);
    await waitFor(() => expect(api.fetchFieldEntryDetail).toHaveBeenCalled());
    expect(screen.queryByText(/削除/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /フィールドログ対象外として無効化する/ }));
    expect(screen.getByText(/記録・写真・Sheets の行は残り/)).toBeInTheDocument();
    const reason = screen.getByLabelText('無効化の理由') as HTMLInputElement;
    expect(reason.value).toBe('フィールドログ対象外（料理・メモ書きなど）');
    fireEvent.change(reason, { target: { value: '' } });
    expect(screen.getByRole('button', { name: '無効化する' })).toBeDisabled();
    fireEvent.change(reason, { target: { value: 'メモ書きの写真' } });
    api.voidFieldEntryLatest.mockResolvedValue({ updatedAt: 't2', linkedSpotCount: 0 });
    fireEvent.click(screen.getByRole('button', { name: '無効化する' }));
    await waitFor(() => expect(api.voidFieldEntryLatest).toHaveBeenCalledWith('e1', 'メモ書きの写真', 'test-token'));
  });
});

describe('地図の重複: 選んだ記録を 1 件ずつ無効化', () => {
  it('2. 理由「重複」で 1 件ずつ。途中で失敗しても続け、件数と失敗を表示し、失敗した記録だけ選んだまま残す', async () => {
    // 同じ撮影時刻・同じ位置 → 後から送った方（recordedAt が新しい方）が重複候補
    const entries = [
      mk('a', { foodName: 'ナラタケ', recordedAt: '2026-09-28T12:00:00+09:00' }),
      mk('b', { foodName: 'ナラタケ', recordedAt: '2026-10-06T19:00:00+09:00' }),
      mk('c', { foodName: 'ナラタケ', recordedAt: '2026-10-06T19:10:00+09:00' }),
    ];
    const reload = vi.fn(async () => {});
    zukan.fetchFieldLogEntries.mockResolvedValue(entries);
    useZukanFieldStore.setState({ entries, loadState: 'ready', errorMessage: '', ensureLoaded: vi.fn(async () => {}), reload });
    render(<ZukanFieldMapScreen go={vi.fn()} from={{ name: 'home' }} />);
    fireEvent.click(await screen.findByRole('button', { name: /絞り込み・並び替え/ })); // 既定は畳んである
    expect(screen.queryByText(/削除/)).toBeNull();
    fireEvent.click(await screen.findByRole('button', { name: '選択して無効化' }));
    fireEvent.click(screen.getAllByText('☐')[0]);
    fireEvent.click(screen.getAllByText('☐')[0]);
    fireEvent.click(screen.getByRole('button', { name: '無効化する' }));
    expect(screen.getByText(/2件を無効化しますか？（理由「重複」/)).toBeInTheDocument();
    api.voidFieldEntryLatest.mockResolvedValueOnce({ updatedAt: 'x', linkedSpotCount: 0 }).mockRejectedValueOnce(new Error('この記録は無効化されています。'));
    fireEvent.click(screen.getByRole('button', { name: '実行する' }));
    expect(await screen.findByText('2件中1件を無効化しました')).toBeInTheDocument();
    expect(screen.getByText(/失敗: ナラタケ（2026-09-26） — この記録は無効化されています。/)).toBeInTheDocument();
    expect(api.voidFieldEntryLatest).toHaveBeenCalledTimes(2);
    expect(api.voidFieldEntryLatest.mock.calls.map((c) => c[1])).toEqual(['重複', '重複']);
    expect(reload).toHaveBeenCalled();
    expect(screen.getAllByText('☑')).toHaveLength(1); // 失敗した 1 件だけ選んだまま
  });
});
