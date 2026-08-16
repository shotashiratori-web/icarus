import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import FoodEditorFormScreen from '../src/screens/FoodEditorFormScreen';
import { mockUseAuth } from './testAuth';
import type { FoodEntity } from '../src/types/knowledge';

vi.mock('../src/context/AuthContext', () => ({ useAuth: () => mockUseAuth() }));

const { fetchAllFoods, createFood } = vi.hoisted(() => ({
  fetchAllFoods: vi.fn(),
  createFood: vi.fn(),
}));
vi.mock('../src/api/knowledgeApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/api/knowledgeApi')>();
  return { ...actual, fetchAllFoods, createFood };
});

function food(overrides: Partial<FoodEntity>): FoodEntity {
  return {
    id: 'id-' + Math.random(),
    canonicalName: '',
    aliases: [],
    usableParts: [],
    description: '',
    createdAt: '',
    updatedAt: '',
    createdBy: '',
    ...overrides,
  };
}

async function renderReady(existingFoods: FoodEntity[] = []) {
  fetchAllFoods.mockResolvedValue(existingFoods);
  render(<FoodEditorFormScreen go={vi.fn()} mode="create" />);
  await screen.findByPlaceholderText('例: トマト');
}

describe('FoodEditorFormScreen', () => {
  beforeEach(() => {
    fetchAllFoods.mockReset();
    createFood.mockReset();
  });

  it('1. canonical必須: 未入力では確認ボタンがdisabledで理由が表示される', async () => {
    await renderReady([]);
    expect(screen.getByText('正式名称を入力してください')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '内容を確認' })).toBeDisabled();
  });

  it('2. canonical conflict: 既存Foodと同名を入力すると確認ボタンがdisabledのまま', async () => {
    const user = userEvent.setup();
    await renderReady([food({ canonicalName: 'トマト' })]);
    await user.type(screen.getByPlaceholderText('例: トマト'), 'トマト');
    expect(await screen.findByText(/既にFood「トマト」で使われています/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '内容を確認' })).toBeDisabled();
  });

  it('3. alias追加: 別名を入力して追加するとchipが表示される', async () => {
    const user = userEvent.setup();
    await renderReady([]);
    await user.type(screen.getByPlaceholderText('例: トマト'), '新食材');
    await user.type(screen.getByPlaceholderText('例: アンズ'), 'べつめい');
    await user.click(screen.getByRole('button', { name: '+ 別名を追加' }));
    expect(screen.getByText('べつめい')).toBeInTheDocument();
  });

  it('4. alias = canonical拒否: 正式名称と同じ別名は追加できない', async () => {
    const user = userEvent.setup();
    await renderReady([]);
    await user.type(screen.getByPlaceholderText('例: トマト'), '玉ねぎ');
    await user.type(screen.getByPlaceholderText('例: アンズ'), '玉ねぎ');
    await user.click(screen.getByRole('button', { name: '+ 別名を追加' }));
    expect(await screen.findByText('正式名称と同じ別名は追加できません')).toBeInTheDocument();
  });

  it('5. alias他Food conflict: 他Foodのaliasと同名は追加できない', async () => {
    const user = userEvent.setup();
    await renderReady([food({ canonicalName: '杏', aliases: ['アンズ'] })]);
    await user.type(screen.getByPlaceholderText('例: トマト'), '桃');
    await user.type(screen.getByPlaceholderText('例: アンズ'), 'アンズ');
    await user.click(screen.getByRole('button', { name: '+ 別名を追加' }));
    expect(await screen.findByText(/既にFood「杏」で使われています/)).toBeInTheDocument();
  });

  it('6. usable_parts追加: 利用部位を入力して追加するとchipが表示される', async () => {
    const user = userEvent.setup();
    await renderReady([]);
    await user.type(screen.getByPlaceholderText('例: 実'), '実');
    await user.click(screen.getByRole('button', { name: '+ 利用部位を追加' }));
    expect(screen.getByText('実')).toBeInTheDocument();
  });

  it('7. confirm phase: 有効な入力で確認画面へ遷移する', async () => {
    const user = userEvent.setup();
    await renderReady([]);
    await user.type(screen.getByPlaceholderText('例: トマト'), 'トマト');
    await user.click(screen.getByRole('button', { name: '内容を確認' }));
    expect(await screen.findByRole('heading', { name: 'トマト' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Foodとして保存' })).toBeInTheDocument();
  });

  it('8. save failure時state保持: 保存失敗してもフォーム内容がリセットされない', async () => {
    const user = userEvent.setup();
    createFood.mockRejectedValue(new Error('サーバーエラーが発生しました'));
    await renderReady([]);
    await user.type(screen.getByPlaceholderText('例: トマト'), 'トマト');
    await user.click(screen.getByRole('button', { name: '内容を確認' }));
    await user.click(await screen.findByRole('button', { name: 'Foodとして保存' }));
    await waitFor(() => expect(screen.getByText('サーバーエラーが発生しました')).toBeInTheDocument());
    // 確認画面のまま、入力していた正式名称が消えていないこと
    expect(screen.getByRole('heading', { name: 'トマト' })).toBeInTheDocument();
  });
});
