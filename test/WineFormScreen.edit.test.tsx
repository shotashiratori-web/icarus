import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import WineFormScreen from '../src/screens/WineFormScreen';
import WineDetailScreen from '../src/screens/WineDetailScreen';
import { mockUseAuth } from './testAuth';
import { EditConflictError } from '../src/api/editErrors';
import type { StaffMe } from '../src/types/staff';
import type { WineEntity } from '../src/types/wineEntity';

// Wine Editing（2026-09-28）: 編集は共通 API 契約の PATCH（変えた項目だけ・編集開始時の updated_at・requestId）。
// 409 は最新を読み直して自分の入力を残す（自動再保存なし）。写真は 1 枚目だけ差し替え、元データの画像は残す。
// 無効化は admin だけ。旧 PUT は使わない

const auth = vi.hoisted(() => ({ staffMe: null as StaffMe | null }));
vi.mock('../src/context/AuthContext', () => ({ useAuth: () => mockUseAuth({ staffMe: auth.staffMe }) }));

const api = vi.hoisted(() => ({ fetchWine: vi.fn(), patchWine: vi.fn(), fetchWineHistory: vi.fn(), fetchWineTastingNotesByWine: vi.fn() }));
vi.mock('../src/api/wineEntityApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/api/wineEntityApi')>()),
  fetchWine: api.fetchWine, patchWine: api.patchWine, fetchWineHistory: api.fetchWineHistory,
}));
vi.mock('../src/api/wineTastingNoteApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/api/wineTastingNoteApi')>()),
  fetchWineTastingNotesByWine: api.fetchWineTastingNotesByWine,
}));

const STAFF: StaffMe = { email: 'staff@test.invalid', displayName: 'Test Staff', role: 'staff', staffStatus: 'active' };
const ADMIN: StaffMe = { email: 'admin@test.invalid', displayName: 'Test Admin', role: 'admin', staffStatus: 'active' };

const wine = (over: Partial<WineEntity> = {}): WineEntity => ({
  id: 'w1', title: 'ナナツモリ', description: '', photos: ['https://img/bottle.jpg', 'https://img/source.jpg'], tags: [],
  status: 'active', producer: 'ドメーヌタカヒコ', vintage: 2022, variety: '', origin: '',
  createdAt: '', updatedAt: 't1', createdBy: '', ...over,
});

async function openEdit(w = wine()) {
  const go = vi.fn();
  render(<WineFormScreen go={go} mode="edit" wine={w} />);
  await waitFor(() => expect(api.fetchWine).toHaveBeenCalled());
  await screen.findByRole('button', { name: '変更なし（閉じる）' });
  return go;
}
const producerInput = () => screen.getAllByRole('textbox')[2]; // 写真URL・ワイン名・生産者の順

describe('WineFormScreen（編集）', () => {
  beforeEach(() => {
    auth.staffMe = STAFF;
    api.fetchWine.mockReset().mockResolvedValue(wine());
    api.patchWine.mockReset().mockResolvedValue('applied');
    api.fetchWineHistory.mockReset().mockResolvedValue([]);
    api.fetchWineTastingNotesByWine.mockReset().mockResolvedValue([]);
  });

  it('1. 変えた項目だけ・編集開始時の updated_at・requestId で PATCH し、保存後は詳細へ', async () => {
    const go = await openEdit();
    fireEvent.change(producerInput(), { target: { value: 'ドメーヌ・タカヒコ' } });
    expect(screen.getByText('変更する項目: 生産者')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() => expect(go).toHaveBeenCalledWith(expect.objectContaining({ name: 'wineDetail' })));
    const [id, body] = api.patchWine.mock.calls[0];
    expect(id).toBe('w1');
    expect(body.expectedUpdatedAt).toBe('t1');
    expect(body.changes).toEqual({ producer: 'ドメーヌ・タカヒコ' });
    expect(body.requestId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('2. 写真URLを変えると 1 枚目だけ差し替え、元データの画像（2 枚目以降）は残す', async () => {
    await openEdit();
    fireEvent.change(screen.getAllByRole('textbox')[0], { target: { value: 'https://img/new.jpg' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() => expect(api.patchWine).toHaveBeenCalled());
    expect(api.patchWine.mock.calls[0][1].changes).toEqual({ photos: ['https://img/new.jpg', 'https://img/source.jpg'] });
  });

  it('3. 409: 最新を読み、自分の入力を残し、競合項目を示す。自動で再保存しない。再保存の expected は最新', async () => {
    await openEdit();
    fireEvent.change(producerInput(), { target: { value: 'ドメーヌ・タカヒコ' } });
    api.patchWine.mockRejectedValueOnce(new EditConflictError('他の人が先に更新しました'));
    api.fetchWine.mockResolvedValue(wine({ producer: '他の人の表記', origin: '余市', updatedAt: 't9' }));
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    expect(await screen.findByText('他の人が先にこの記録を更新しました')).toBeInTheDocument();
    expect(producerInput()).toHaveValue('ドメーヌ・タカヒコ'); // 自分の入力
    expect(screen.getByDisplayValue('余市')).toBeInTheDocument(); // 自分が変えていない項目は最新
    expect(screen.getByRole('alert')).toHaveTextContent('生産者は他の人も変更しています');
    expect(api.patchWine).toHaveBeenCalledTimes(1);
    api.patchWine.mockResolvedValueOnce('applied');
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() => expect(api.patchWine).toHaveBeenCalledTimes(2));
    expect(api.patchWine.mock.calls[1][1]).toMatchObject({ expectedUpdatedAt: 't9', changes: { producer: 'ドメーヌ・タカヒコ' } });
  });

  it('4. 通信失敗の後に同じ内容で保存し直すと同じ requestId（二重に書かない）', async () => {
    await openEdit();
    fireEvent.change(producerInput(), { target: { value: 'x' } });
    api.patchWine.mockRejectedValueOnce(new Error('通信エラーが発生しました。もう一度お試しください。'));
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    await screen.findByText('通信エラーが発生しました。もう一度お試しください。');
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() => expect(api.patchWine).toHaveBeenCalledTimes(2));
    expect(api.patchWine.mock.calls[0][1].requestId).toBe(api.patchWine.mock.calls[1][1].requestId);
  });

  it('5. admin の無効化は PATCH status=archived（物理削除はしない）', async () => {
    auth.staffMe = ADMIN;
    await openEdit();
    fireEvent.click(screen.getByRole('button', { name: 'このワインを無効化' }));
    fireEvent.click(screen.getByRole('button', { name: '無効化する' }));
    await waitFor(() => expect(api.patchWine).toHaveBeenCalled());
    expect(api.patchWine.mock.calls[0][1]).toMatchObject({ expectedUpdatedAt: 't1', changes: { status: 'archived' } });
  });
});

describe('WineDetailScreen（編集履歴）', () => {
  beforeEach(() => {
    auth.staffMe = STAFF;
    api.fetchWine.mockReset().mockResolvedValue(wine({ producer: 'ドメーヌ・タカヒコ' }));
    api.fetchWineTastingNotesByWine.mockReset().mockResolvedValue([]);
    api.fetchWineHistory.mockReset().mockResolvedValue([
      { id: 'h1', editedAt: '2026-09-27T21:30:18.195Z', editedByName: '翔大（サブ）', editedBy: 'x', source: 'detail', reason: '表記統一', changes: [{ field: 'producer', old: 'ドメーヌタカヒコ', new: 'ドメーヌ・タカヒコ' }] },
      { id: 'h2', editedAt: '2026-09-28T01:00:00Z', editedByName: '翔大', editedBy: 'y', source: 'detail', reason: null, changes: [{ field: 'status', old: 'active', new: 'archived' }] },
    ]);
  });

  it('6. 詳細は最新を読み直し、編集履歴を新しい順に表示（無効化は「無効化」と表示）', async () => {
    render(<WineDetailScreen go={vi.fn()} entry={wine()} />);
    expect(await screen.findByText('🏭 ドメーヌ・タカヒコ')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /編集履歴/ }));
    await screen.findByText(/翔大（サブ）/);
    const items = screen.getAllByRole('listitem').filter((li) => li.querySelector('ul'));
    expect(items[0]).toHaveTextContent('翔大・無効化');
    expect(items[0]).toHaveTextContent('状態有効 → 無効化');
    expect(items[1]).toHaveTextContent('翔大（サブ）・編集');
    expect(items[1]).toHaveTextContent('表記統一');
    expect(items[1]).toHaveTextContent('生産者ドメーヌタカヒコ → ドメーヌ・タカヒコ');
  });
});
