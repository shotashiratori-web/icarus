import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import WineFormScreen from '../src/screens/WineFormScreen';
import SpotFormScreen from '../src/screens/SpotFormScreen';
import { mockUseAuth } from './testAuth';
import type { StaffMe } from '../src/types/staff';
import type { WineEntity } from '../src/types/wineEntity';
import type { SpotEntity } from '../src/types/spotEntity';

// 図鑑エンティティ（Wine・Spot）の削除は admin だけ（編集共通化 Audit G1・G2、2026-09-27）。
// staff には編集画面の削除ボタンを出さない（API 側でも admin 以外は 403）。通常の保存は staff にも出す。
// Wine は 2026-09-28 から物理削除ボタンを出さず、admin の「無効化」（archive）に置き換え

const auth = vi.hoisted(() => ({ staffMe: null as StaffMe | null }));
vi.mock('../src/context/AuthContext', () => ({ useAuth: () => mockUseAuth({ staffMe: auth.staffMe }) }));
// Wine 編集画面は開いた時に最新を読み直す（Wine Editing、2026-09-28）
vi.mock('../src/api/wineEntityApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/api/wineEntityApi')>()),
  fetchWine: vi.fn(async () => wine),
}));

const STAFF: StaffMe = { email: 'staff@test.invalid', displayName: 'Test Staff', role: 'staff', staffStatus: 'active' };
const ADMIN: StaffMe = { email: 'admin@test.invalid', displayName: 'Test Admin', role: 'admin', staffStatus: 'active' };

const wine: WineEntity = {
  id: 'w1', title: 'モンロゼ', description: '', photos: [], tags: [], status: 'active',
  producer: '', vintage: null, variety: '', origin: '', createdAt: '', updatedAt: '', createdBy: '',
};
const spot: SpotEntity = {
  id: 's1', title: '神社', description: '', photos: [], tags: [], status: 'active',
  category: '', lat: null, lng: null, createdAt: '', updatedAt: '', createdBy: '',
};

describe('Wine・Spot 編集画面の削除ボタン', () => {
  it('1. staff にはワインの削除・無効化ボタンが出ない（保存のフッターは出る）', async () => {
    auth.staffMe = STAFF;
    render(<WineFormScreen go={vi.fn()} mode="edit" wine={wine} />);
    expect(await screen.findByRole('button', { name: '変更なし（閉じる）' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'このワインを削除' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'このワインを無効化' })).not.toBeInTheDocument();
  });

  it('2. admin には「このワインを無効化」が出る。物理削除のボタンは出さない（Wine Editing、2026-09-28）', async () => {
    auth.staffMe = ADMIN;
    render(<WineFormScreen go={vi.fn()} mode="edit" wine={wine} />);
    expect(await screen.findByRole('button', { name: 'このワインを無効化' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'このワインを削除' })).not.toBeInTheDocument();
  });

  it('3. staff にはスポットの削除ボタンが出ない（保存は出る）', () => {
    auth.staffMe = STAFF;
    render(<SpotFormScreen go={vi.fn()} mode="edit" spot={spot} />);
    expect(screen.getByRole('button', { name: /保存/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'このスポットを削除' })).not.toBeInTheDocument();
  });

  it('4. admin にはスポットの削除ボタンが出る', () => {
    auth.staffMe = ADMIN;
    render(<SpotFormScreen go={vi.fn()} mode="edit" spot={spot} />);
    expect(screen.getByRole('button', { name: 'このスポットを削除' })).toBeInTheDocument();
  });
});
