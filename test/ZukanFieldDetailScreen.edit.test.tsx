import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import ZukanFieldDetailScreen from '../src/screens/ZukanFieldDetailScreen';
import { mockUseAuth } from './testAuth';
import type { FieldLogEntry } from '../src/types/zukan';
import type { FieldEditOption, FieldEntryDetail } from '../src/types/fieldEntryEdit';
import type { StaffMe } from '../src/types/staff';

// Editing & Classification: active staff（admin以外も）が詳細から編集できる。
// 変えた項目だけをexpectedUpdatedAt付きで送る・409なら最新を読み直して自分の変更を残す・履歴を見られる

const auth = vi.hoisted(() => ({ staffMe: null as StaffMe | null }));
vi.mock('../src/context/AuthContext', () => ({
  useAuth: () => mockUseAuth({ staffMe: auth.staffMe }),
}));

const api = vi.hoisted(() => ({
  fetchFieldEntryDetail: vi.fn(),
  fetchFieldEditOptions: vi.fn(),
  patchFieldEntry: vi.fn(),
  fetchFieldEntryHistory: vi.fn(),
}));
vi.mock('../src/api/fieldEntryEditApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/api/fieldEntryEditApi')>();
  return { ...actual, ...api };
});

const STAFF: StaffMe = { email: 'staff@test.invalid', displayName: 'Test Staff', role: 'staff', staffStatus: 'active' };

const entry: FieldLogEntry = {
  id: 'x', foodName: 'ナラタケ', place: '余市', date: '2026-09-19', memo: '', photoUrl: '', notionUrl: '',
  elevation: null, kigo: '', lat: 0, lng: 0, recordedAt: '', eventId: 'ev-1', takenAt: '',
};

function detail(over: Partial<FieldEntryDetail> = {}): FieldEntryDetail {
  return {
    eventId: 'ev-1', food: 'ナラタケ', date: '2026-09-19', place: '余市', memo: '', large_category: 'キノコ',
    sub_category: '不明', phase: '幼菌', harvested: 'あり', identification_status: '未確認', observed_parts: ['全体'],
    subject_type: '食材', kigo: '', createdBy: 'other@test.invalid', updatedAt: 't1', ...over,
  };
}

const o = (field: FieldEditOption['field'], value: string, parentValue: string | null = null): FieldEditOption =>
  ({ field, value, label: value, parentValue, sortOrder: 10, isActive: true });
const OPTIONS = [
  o('large_category', 'キノコ'), o('sub_category', '不明'), o('phase', '幼菌', 'キノコ'), o('harvested', 'あり'),
  o('harvested', 'なし'), o('identification_status', '未確認'), o('identification_status', '推定'),
  o('observed_part', '全体'), o('observed_part', '花'), o('record_type', '食材'),
];

const renderScreen = () => render(<ZukanFieldDetailScreen go={vi.fn()} entry={entry} from={{ name: 'zukanTop' } as never} />);

async function startEditing() {
  renderScreen();
  fireEvent.click(await screen.findByRole('button', { name: '編集' }));
  return screen.findByText('編集中');
}

describe('ZukanFieldDetailScreen: Field Log編集（Editing & Classification）', () => {
  beforeEach(() => {
    auth.staffMe = STAFF;
    try { window.localStorage?.clear?.(); } catch { /* テスト環境にlocalStorageが無い場合がある */ }
    api.fetchFieldEntryDetail.mockReset().mockResolvedValue(detail());
    api.fetchFieldEditOptions.mockReset().mockResolvedValue(OPTIONS);
    api.patchFieldEntry.mockReset().mockResolvedValue('applied');
    api.fetchFieldEntryHistory.mockReset().mockResolvedValue([]);
  });

  it('1. admin以外のactive staffにも［編集］が出て、分類・状態を表示する', async () => {
    renderScreen();
    expect(await screen.findByRole('button', { name: '編集' })).toBeInTheDocument();
    expect(await screen.findByText('分類・状態')).toBeInTheDocument();
    expect(screen.getByText('未確認')).toBeInTheDocument();
  });

  it('2. pendingのstaff・ログインしていない人には［編集］も履歴も出ない', async () => {
    auth.staffMe = { ...STAFF, staffStatus: 'pending' };
    renderScreen();
    await screen.findByText('分類・状態');
    expect(screen.queryByRole('button', { name: '編集' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /編集履歴/ })).not.toBeInTheDocument();
  });

  it('3. 変えた項目だけをexpectedUpdatedAt付きで送り、保存後はD1の値を読み直す', async () => {
    await startEditing();
    fireEvent.change(screen.getByLabelText('観察内容'), { target: { value: '傘が大きい' } });
    fireEvent.change(screen.getByDisplayValue('未確認'), { target: { value: '推定' } });
    fireEvent.click(screen.getByRole('checkbox', { name: '花' }));

    api.fetchFieldEntryDetail.mockResolvedValue(detail({ memo: '傘が大きい', identification_status: '推定', observed_parts: ['全体', '花'], updatedAt: 't2' }));
    fireEvent.click(screen.getByRole('button', { name: '保存' }));

    await screen.findByText('保存しました');
    expect(api.patchFieldEntry).toHaveBeenCalledTimes(1);
    const [eventId, body] = api.patchFieldEntry.mock.calls[0];
    expect(eventId).toBe('ev-1');
    expect(body.expectedUpdatedAt).toBe('t1');
    expect(body.changes).toEqual({ memo: '傘が大きい', identification_status: '推定', observed_parts: ['全体', '花'] });
    expect(body.requestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(screen.getByText('傘が大きい')).toBeInTheDocument();
    expect(screen.getByText('全体・花')).toBeInTheDocument();
  });

  it('4. 通信失敗の後に同じ内容で保存し直すと、同じrequestIdを使う（二重に書かない）', async () => {
    await startEditing();
    fireEvent.change(screen.getByLabelText('観察内容'), { target: { value: 'x' } });
    api.patchFieldEntry.mockRejectedValueOnce(new Error('通信エラーが発生しました。もう一度お試しください。'));
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    await screen.findByText('通信エラーが発生しました。もう一度お試しください。');
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    await screen.findByText('保存しました');
    expect(api.patchFieldEntry.mock.calls[0][1].requestId).toBe(api.patchFieldEntry.mock.calls[1][1].requestId);
  });

  it('5. 409なら最新を読み直し、自分の変更は残して「他の人が先に更新しました」を出す。自動では保存しない', async () => {
    const { FieldEditConflictError } = await import('../src/api/fieldEntryEditApi');
    await startEditing();
    fireEvent.change(screen.getByLabelText('観察内容'), { target: { value: '自分のメモ' } });

    api.patchFieldEntry.mockRejectedValueOnce(new FieldEditConflictError('他の人が先にこの記録を更新しました。'));
    api.fetchFieldEntryDetail.mockResolvedValue(detail({ memo: '他の人のメモ', harvested: 'なし', updatedAt: 't9' }));
    fireEvent.click(screen.getByRole('button', { name: '保存' }));

    expect(await screen.findByText('他の人が先にこの記録を更新しました')).toBeInTheDocument();
    expect(screen.getByText(/メモは他の人も変更しています/)).toBeInTheDocument();
    expect(screen.getByLabelText('観察内容')).toHaveValue('自分のメモ');
    expect(screen.getByDisplayValue('なし')).toBeInTheDocument(); // 他の人の変更（採取）は最新値を取り込む
    expect(api.patchFieldEntry).toHaveBeenCalledTimes(1);

    api.patchFieldEntry.mockResolvedValueOnce('applied');
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() => expect(api.patchFieldEntry).toHaveBeenCalledTimes(2));
    const body = api.patchFieldEntry.mock.calls[1][1];
    expect(body.expectedUpdatedAt).toBe('t9');
    expect(body.changes).toEqual({ memo: '自分のメモ' });
  });

  it('6. 食材名を空にすると保存できない', async () => {
    await startEditing();
    fireEvent.change(screen.getByLabelText('食材名'), { target: { value: ' ' } });
    expect(screen.getAllByText('食材名は必須です').length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: '保存' })).toBeDisabled();
  });

  it('7. 編集履歴を新しい順に、誰が・いつ・何を・変更前→変更後で表示する', async () => {
    api.fetchFieldEntryHistory.mockResolvedValue([
      { id: 'h1', editedAt: '2026-08-01T00:00:00+09:00', editedBy: 'a@x', editedByName: '旧担当', source: 'legacy_gas', reason: null, bulkId: null, derived: false, changes: [{ field: 'memo', old: '', new: '初回' }] },
      { id: 'h2', editedAt: '2026-09-26T03:00:00Z', editedBy: 'b@x', editedByName: '山田', source: 'detail', reason: null, bulkId: null, derived: false, changes: [{ field: 'date', old: '2026-07-13', new: '2026-06-10' }] },
    ]);
    renderScreen();
    fireEvent.click(await screen.findByRole('button', { name: /編集履歴/ }));
    const items = await screen.findAllByRole('listitem');
    expect(items[0]).toHaveTextContent('山田');
    expect(items[0]).toHaveTextContent('詳細画面で編集');
    expect(items[0]).toHaveTextContent('観察日2026-07-13 → 2026-06-10');
    expect(screen.getByText(/旧システムで編集/)).toBeInTheDocument();
    expect(screen.getByText(/（空欄） → 初回/)).toBeInTheDocument();
  });
});
