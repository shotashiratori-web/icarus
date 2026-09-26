import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import FieldIncompleteListScreen from '../src/screens/FieldIncompleteListScreen';
import { mockUseAuth } from './testAuth';
import { useZukanFieldStore } from '../src/store/zukanFieldStore';
import type { FieldLogEntry } from '../src/types/zukan';
import type { FieldEditOption } from '../src/types/fieldEntryEdit';
import type { StaffMe } from '../src/types/staff';

// まとめて編集（記録の補完に複数選択モードを追加）。active staff以上・記録ごとに独立・成功/競合/失敗の表示・
// 競合した記録だけやり直す・曖昧な再送は同じrequestId

const auth = vi.hoisted(() => ({ staffMe: null as StaffMe | null }));
vi.mock('../src/context/AuthContext', () => ({ useAuth: () => mockUseAuth({ staffMe: auth.staffMe }) }));

const api = vi.hoisted(() => ({
  fetchFieldEntryDetail: vi.fn(),
  fetchFieldEditOptions: vi.fn(),
  bulkEditFieldEntries: vi.fn(),
}));
vi.mock('../src/api/fieldEntryEditApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/api/fieldEntryEditApi')>()),
  ...api,
}));

const STAFF: StaffMe = { email: 'staff@test.invalid', displayName: 'Test Staff', role: 'staff', staffStatus: 'active' };

const mk = (eventId: string, foodName: string, date: string, over: Partial<FieldLogEntry> = {}): FieldLogEntry => ({
  id: eventId, foodName, place: '', date, memo: '', photoUrl: '', notionUrl: '', elevation: null, kigo: '',
  lat: 43, lng: 140, recordedAt: '', eventId, takenAt: '', ...over,
});
const ENTRIES = [mk('e1', 'ナラタケ', '2026-09-01'), mk('e2', 'セリ', '2026-09-02'), mk('e3', 'サルナシ', '2026-09-03')];

const o = (field: FieldEditOption['field'], value: string): FieldEditOption =>
  ({ field, value, label: value, parentValue: null, sortOrder: 10, isActive: true });
const OPTIONS = [o('identification_status', '未確認'), o('identification_status', '推定'), o('large_category', 'キノコ'), o('observed_part', '全体')];

function renderScreen() {
  useZukanFieldStore.setState({ entries: ENTRIES, loadState: 'ready', errorMessage: '' });
  const go = vi.fn();
  render(<FieldIncompleteListScreen go={go} from={{ name: 'field' } as never} />);
  return go;
}

async function openBulkWithAll() {
  fireEvent.click(screen.getByRole('button', { name: '複数選択' }));
  fireEvent.click(screen.getByRole('button', { name: '表示中をすべて選ぶ' }));
  fireEvent.click(screen.getByRole('button', { name: 'まとめて編集' }));
  await screen.findByRole('button', { name: '3件に保存' });
  fireEvent.change(screen.getByLabelText('同定状態'), { target: { value: '推定' } });
}

describe('FieldIncompleteListScreen: まとめて編集', () => {
  beforeEach(() => {
    auth.staffMe = STAFF;
    api.fetchFieldEditOptions.mockReset().mockResolvedValue(OPTIONS);
    api.fetchFieldEntryDetail.mockReset().mockImplementation(async (id: string) => ({ eventId: id, updatedAt: `t-${id}` }));
    api.bulkEditFieldEntries.mockReset();
  });

  it('1. 通常モードのタップは今までどおり詳細へ進む', () => {
    const go = renderScreen();
    fireEvent.click(screen.getByText('ナラタケ'));
    expect(go).toHaveBeenCalledWith(expect.objectContaining({ name: 'zukanFieldDetail' }));
  });

  it('2. pendingのstaffには複数選択を出さない', () => {
    auth.staffMe = { ...STAFF, staffStatus: 'pending' };
    renderScreen();
    expect(screen.queryByRole('button', { name: '複数選択' })).not.toBeInTheDocument();
  });

  it('3. 各記録のupdated_atを開いた時点で読み、変えた項目だけを送る。全件成功', async () => {
    const go = renderScreen();
    await openBulkWithAll();
    api.bulkEditFieldEntries.mockResolvedValue({
      bulkId: 'b', results: ['e1', 'e2', 'e3'].map((eventId) => ({ eventId, ok: true, outcome: 'applied', message: '' })),
    });
    fireEvent.click(screen.getByRole('button', { name: '3件に保存' }));
    expect(await screen.findByText('成功 3件')).toBeInTheDocument();
    expect(screen.getByText('競合 0件')).toBeInTheDocument();
    expect(screen.getByText('失敗 0件')).toBeInTheDocument();
    const body = api.bulkEditFieldEntries.mock.calls[0][0];
    expect(body.entries).toEqual([
      { eventId: 'e1', expectedUpdatedAt: 't-e1' }, { eventId: 'e2', expectedUpdatedAt: 't-e2' }, { eventId: 'e3', expectedUpdatedAt: 't-e3' },
    ]);
    expect(body.changes).toEqual({ identification_status: '推定' });
    expect(body.requestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(go).not.toHaveBeenCalled();
  });

  it('4. 2件成功・1件競合: 競合した記録を食材名で示し、その1件だけをやり直す', async () => {
    renderScreen();
    await openBulkWithAll();
    api.bulkEditFieldEntries.mockResolvedValueOnce({
      bulkId: 'b',
      results: [
        { eventId: 'e1', ok: true, outcome: 'applied', message: '' },
        { eventId: 'e2', ok: false, code: 'EDIT_CONFLICT', message: '他の人が先に…' },
        { eventId: 'e3', ok: true, outcome: 'applied', message: '' },
      ],
    });
    fireEvent.click(screen.getByRole('button', { name: '3件に保存' }));
    expect(await screen.findByText('成功 2件')).toBeInTheDocument();
    expect(screen.getByText('競合 1件')).toBeInTheDocument();
    expect(screen.getByText('失敗 0件')).toBeInTheDocument();
    const panel = screen.getByRole('region', { name: 'まとめて編集の結果' });
    expect(within(panel).getByText('セリ')).toBeInTheDocument();
    expect(within(panel).getByText('2026-09-02')).toBeInTheDocument();

    api.fetchFieldEntryDetail.mockClear();
    api.fetchFieldEntryDetail.mockImplementation(async (id: string) => ({ eventId: id, updatedAt: `t2-${id}` }));
    fireEvent.click(screen.getByRole('button', { name: /競合した1件だけ/ }));
    await screen.findByRole('button', { name: '1件に保存' });
    expect(api.fetchFieldEntryDetail).toHaveBeenCalledTimes(1);
    expect(api.fetchFieldEntryDetail).toHaveBeenCalledWith('e2', 'test-token');
  });

  it('5. 失敗（検証エラー）は理由と記録を示す', async () => {
    renderScreen();
    await openBulkWithAll();
    api.bulkEditFieldEntries.mockResolvedValue({
      bulkId: 'b',
      results: [
        { eventId: 'e1', ok: true, outcome: 'noChange', message: '' },
        { eventId: 'e2', ok: true, outcome: 'applied', message: '' },
        { eventId: 'e3', ok: false, code: 'EDIT_NOT_FOUND', message: '記録が見つかりません' },
      ],
    });
    fireEvent.click(screen.getByRole('button', { name: '3件に保存' }));
    const panel = await screen.findByRole('region', { name: 'まとめて編集の結果' });
    expect(within(panel).getByText('失敗 1件')).toBeInTheDocument();
    expect(within(panel).getByText('サルナシ').parentElement).toHaveTextContent('記録が見つかりません');
    expect(within(panel).getByText(/1件は、すでに同じ値/)).toBeInTheDocument();
  });

  it('6. 通信結果が分からず保存し直す時は同じrequestIdを使う', async () => {
    renderScreen();
    await openBulkWithAll();
    api.bulkEditFieldEntries.mockRejectedValueOnce(new Error('通信エラーが発生しました。もう一度お試しください。'));
    fireEvent.click(screen.getByRole('button', { name: '3件に保存' }));
    await screen.findByText('通信エラーが発生しました。もう一度お試しください。');
    api.bulkEditFieldEntries.mockResolvedValueOnce({
      bulkId: 'b', results: ['e1', 'e2', 'e3'].map((eventId) => ({ eventId, ok: true, outcome: 'alreadyApplied', message: '' })),
    });
    fireEvent.click(screen.getByRole('button', { name: '3件に保存' }));
    await screen.findByText('成功 3件');
    await waitFor(() => expect(api.bulkEditFieldEntries).toHaveBeenCalledTimes(2));
    expect(api.bulkEditFieldEntries.mock.calls[0][0].requestId).toBe(api.bulkEditFieldEntries.mock.calls[1][0].requestId);
  });

  it('7. 同じ日・同じ場所・同じ食材名が並んでも、競合した記録を写真と撮影時刻で見分けられる（EventIDは出さない）', async () => {
    const same = (id: string, takenAt: string, thumb: string) =>
      mk(id, 'ナラタケ', '2026-09-21', { place: '余市', takenAt, photoUrl: `https://example.test/${id}.jpg`, thumbnailUrl: thumb });
    useZukanFieldStore.setState({
      entries: [
        same('n1', '2026-09-21T11:14:33+09:00', 'https://example.test/thumb-n1.jpg'),
        same('n2', '2026-09-21T11:18:34+09:00', 'https://example.test/thumb-n2.jpg'),
      ],
      loadState: 'ready', errorMessage: '',
    });
    render(<FieldIncompleteListScreen go={vi.fn()} from={{ name: 'field' } as never} />);
    fireEvent.click(screen.getByRole('button', { name: '複数選択' }));
    fireEvent.click(screen.getByRole('button', { name: '表示中をすべて選ぶ' }));
    fireEvent.click(screen.getByRole('button', { name: 'まとめて編集' }));
    await screen.findByRole('button', { name: '2件に保存' });
    fireEvent.change(screen.getByLabelText('同定状態'), { target: { value: '推定' } });
    api.bulkEditFieldEntries.mockResolvedValue({
      bulkId: 'b',
      results: [
        { eventId: 'n1', ok: true, outcome: 'applied', message: '' },
        { eventId: 'n2', ok: false, code: 'EDIT_CONFLICT', message: '' },
      ],
    });
    fireEvent.click(screen.getByRole('button', { name: '2件に保存' }));
    const panel = await screen.findByRole('region', { name: 'まとめて編集の結果' });
    const item = within(panel).getByRole('listitem');
    expect(item).toHaveTextContent('ナラタケ');
    const t = new Date('2026-09-21T11:18:34+09:00'); // 表示は端末の時刻（テスト環境のタイムゾーンに依存させない）
    const hhmm = `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`;
    expect(item).toHaveTextContent(`撮影 ${hhmm}・2026-09-21・余市`);
    expect(item.querySelector('img')?.getAttribute('src')).toBe('https://example.test/thumb-n2.jpg');
    expect(item).not.toHaveTextContent('n2');
  });
});
