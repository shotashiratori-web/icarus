import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import ZukanFieldDetailScreen from '../src/screens/ZukanFieldDetailScreen';
import { mockUseAuth } from './testAuth';
import { useZukanFieldStore } from '../src/store/zukanFieldStore';
import { FieldEntryVoidedError } from '../src/api/fieldEntryEditApi';
import type { FieldLogEntry } from '../src/types/zukan';
import type { FieldEntryDetail } from '../src/types/fieldEntryEdit';
import type { StaffMe } from '../src/types/staff';

// Field Log の無効化（削除の代わり）の画面。設計: icarus_field_log_void_design.md
// 管理者だけ・理由必須・訂正とは別の行。無効化済みの記録は「無効化されています」を出し、編集できない

const auth = vi.hoisted(() => ({ staffMe: null as StaffMe | null }));
vi.mock('../src/context/AuthContext', () => ({
  useAuth: () => mockUseAuth({ staffMe: auth.staffMe }),
}));

const api = vi.hoisted(() => ({
  fetchFieldEntryDetail: vi.fn(),
  fetchFieldEditOptions: vi.fn(),
  patchFieldEntry: vi.fn(),
  fetchFieldEntryHistory: vi.fn(),
  voidFieldEntry: vi.fn(),
}));
vi.mock('../src/api/fieldEntryEditApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/api/fieldEntryEditApi')>();
  return { ...actual, ...api };
});

const STAFF: StaffMe = { email: 'staff@test.invalid', displayName: 'Test Staff', role: 'staff', staffStatus: 'active' };
const ADMIN: StaffMe = { email: 'admin@test.invalid', displayName: '翔大', role: 'admin', staffStatus: 'active' };

const entry: FieldLogEntry = {
  id: 'x', foodName: '本舞茸', place: '赤井川', date: '2026-10-06', memo: '', photoUrl: '', notionUrl: '',
  elevation: null, kigo: '', lat: 0, lng: 0, recordedAt: '', eventId: 'ev-1', takenAt: '',
};

function detail(over: Partial<FieldEntryDetail> = {}): FieldEntryDetail {
  return {
    eventId: 'ev-1', food: '本舞茸', date: '2026-10-06', place: '赤井川', memo: '', large_category: 'キノコ',
    sub_category: '不明', phase: '', harvested: '不明', identification_status: '未確認', observed_parts: [],
    subject_type: '食材', kigo: '', createdBy: 'staff@test.invalid', updatedAt: 't1', status: 'active', ...over,
  };
}

const renderScreen = () => render(<ZukanFieldDetailScreen go={vi.fn()} entry={entry} from={{ name: 'zukanTop' } as never} />);

beforeEach(() => {
  vi.clearAllMocks();
  api.fetchFieldEntryHistory.mockResolvedValue([]);
});

describe('記録の無効化', () => {
  it('1. 一般スタッフには無効化のボタンを出さない（編集はできる）', async () => {
    auth.staffMe = STAFF;
    api.fetchFieldEntryDetail.mockResolvedValue(detail());
    renderScreen();
    expect(await screen.findByRole('button', { name: '編集' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'この記録を無効化' })).toBeNull();
  });

  it('2. 管理者: 理由を入れるまで押せない → 無効化 → 無効化済みの表示・一覧から外す・Spot の件数を知らせる', async () => {
    auth.staffMe = ADMIN;
    api.fetchFieldEntryDetail.mockResolvedValueOnce(detail());
    const removeEntry = vi.spyOn(useZukanFieldStore.getState(), 'removeEntry');
    renderScreen();
    fireEvent.click(await screen.findByRole('button', { name: 'この記録を無効化' }));
    expect(screen.getByText(/Spot・写真・観察は残ります/)).toBeInTheDocument();
    const go = screen.getByRole('button', { name: '無効化する' });
    expect(go).toBeDisabled();
    fireEvent.change(screen.getByLabelText('無効化の理由'), { target: { value: '同じ発見の重複記録' } });
    expect(go).not.toBeDisabled();

    api.voidFieldEntry.mockResolvedValue({ updatedAt: 't2', linkedSpotCount: 1 });
    api.fetchFieldEntryDetail.mockResolvedValueOnce(detail({ status: 'voided', updatedAt: 't2', voidedAt: '2026-10-07T01:00:00Z', voidedByName: '翔大', voidReason: '同じ発見の重複記録' }));
    fireEvent.click(go);

    expect(await screen.findByText('この記録は無効化されています')).toBeInTheDocument();
    const [eventId, body] = api.voidFieldEntry.mock.calls[0] as [string, { requestId: string; expectedUpdatedAt: string; reason: string }];
    expect(eventId).toBe('ev-1');
    expect(body).toMatchObject({ expectedUpdatedAt: 't1', reason: '同じ発見の重複記録' });
    expect(body.requestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(removeEntry).toHaveBeenCalledWith('ev-1');
    expect(screen.getByText(/Environment Spot 1 件の根拠になっていました/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '編集' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'この記録を無効化' })).toBeNull();
  });

  it('3. 無効化済みの記録を開くと、理由と人を出し、編集・無効化のボタンは出さない（履歴は見られる）', async () => {
    auth.staffMe = ADMIN;
    api.fetchFieldEntryDetail.mockResolvedValue(detail({ status: 'voided', voidedAt: '2026-10-07T01:00:00Z', voidedByName: '翔大', voidReason: '写真の撮り直し' }));
    renderScreen();
    expect(await screen.findByText('この記録は無効化されています')).toBeInTheDocument();
    expect(screen.getByText(/理由: 写真の撮り直し/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '編集' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'この記録を無効化' })).toBeNull();
    expect(screen.getByRole('button', { name: /編集履歴/ })).toBeInTheDocument();
  });

  it('4. 既に無効化されていた時は、その旨を出す（「他の人が先に更新」とは言わない）', async () => {
    auth.staffMe = ADMIN;
    api.fetchFieldEntryDetail.mockResolvedValue(detail());
    api.voidFieldEntry.mockRejectedValue(new FieldEntryVoidedError());
    renderScreen();
    fireEvent.click(await screen.findByRole('button', { name: 'この記録を無効化' }));
    fireEvent.change(screen.getByLabelText('無効化の理由'), { target: { value: '重複' } });
    fireEvent.click(screen.getByRole('button', { name: '無効化する' }));
    await waitFor(() => expect(screen.getByText('この記録は無効化されています。')).toBeInTheDocument());
    expect(screen.queryByText(/他の人が先に/)).toBeNull();
  });
});
