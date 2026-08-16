import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ProcessEditorScreen from '../src/screens/ProcessEditorScreen';
import { mockUseAuth } from './testAuth';

vi.mock('../src/context/AuthContext', () => ({ useAuth: () => mockUseAuth() }));

const { fetchAllFoods, fetchAllProcessedProducts, createProcessKnowledge } = vi.hoisted(() => ({
  fetchAllFoods: vi.fn(),
  fetchAllProcessedProducts: vi.fn(),
  createProcessKnowledge: vi.fn(),
}));
vi.mock('../src/api/knowledgeApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/api/knowledgeApi')>();
  return { ...actual, fetchAllFoods, fetchAllProcessedProducts, createProcessKnowledge };
});

async function renderReady() {
  render(<ProcessEditorScreen go={vi.fn()} />);
  await screen.findByPlaceholderText('例: 杏セミドライを作る');
}

// Input候補ボタンは食材アイコン+ラベルの2 span構成のため、roleのaccessible name（部分一致）だと
// 「杏」が「セミドライ杏」ともマッチしてしまう。ラベルspanのexact text一致（既定）から親buttonを辿る
async function clickFoodInputCandidate(label: string) {
  const span = await screen.findByText(label);
  await userEvent.click(span.closest('button')!);
}

describe('ProcessEditorScreen', () => {
  beforeEach(() => {
    fetchAllFoods.mockReset();
    fetchAllProcessedProducts.mockReset();
    createProcessKnowledge.mockReset();
    fetchAllFoods.mockResolvedValue([
      { id: 'f1', canonicalName: '杏', aliases: [], usableParts: [], description: '', createdAt: '', updatedAt: '', createdBy: '' },
    ]);
    fetchAllProcessedProducts.mockResolvedValue([
      { id: 'p1', name: 'セミドライ杏', description: '', createdAt: '', updatedAt: '', createdBy: '' },
    ]);
  });

  it('9. Input重複防止: 追加済みFoodは候補リストから消える', async () => {
    const user = userEvent.setup();
    fetchAllProcessedProducts.mockResolvedValue([]); // 候補をFood 1件のみに絞り、消えたことを明確に確認する
    await renderReady();
    await user.click(screen.getByRole('button', { name: '+ 食材・加工品を追加' }));
    await clickFoodInputCandidate('杏');
    // 一度閉じて再度開く
    await user.click(screen.getByRole('button', { name: '閉じる' }));
    await user.click(screen.getByRole('button', { name: '+ 食材・加工品を追加' }));
    expect(screen.getByText('該当する候補がありません')).toBeInTheDocument();
  });

  it('10. Output重複防止: 追加済みProductは既存候補リストから消える', async () => {
    const user = userEvent.setup();
    await renderReady();
    await user.click(screen.getByRole('button', { name: '+ 加工品を追加' }));
    await user.click(screen.getByRole('button', { name: 'A. 既存加工品を使う' }));
    await user.click(await screen.findByRole('button', { name: 'セミドライ杏' }));
    await user.click(screen.getByRole('button', { name: '+ 加工品を追加' }));
    await user.click(screen.getByRole('button', { name: 'A. 既存加工品を使う' }));
    expect(await screen.findByText('該当する候補がありません')).toBeInTheDocument();
  });

  it('11. steps order: 上へボタンで工程の順序が入れ替わる', async () => {
    const user = userEvent.setup();
    await renderReady();
    await user.click(screen.getByRole('button', { name: '+ 工程を追加' }));
    await user.click(screen.getByRole('button', { name: '+ 工程を追加' }));
    const inputs = screen.getAllByPlaceholderText('工程の内容');
    await user.type(inputs[0], 'ステップ1');
    await user.type(inputs[1], 'ステップ2');
    const upButtons = screen.getAllByLabelText('上へ');
    await user.click(upButtons[1]); // 2番目の工程を上へ
    const after = screen.getAllByPlaceholderText('工程の内容');
    expect(after[0]).toHaveValue('ステップ2');
    expect(after[1]).toHaveValue('ステップ1');
  });

  it('12. confirmation phase: 有効な入力で確認画面へ遷移する', async () => {
    const user = userEvent.setup();
    await renderReady();
    await user.type(screen.getByPlaceholderText('例: 杏セミドライを作る'), '杏セミドライを作る');
    await user.click(screen.getByRole('button', { name: '+ 食材・加工品を追加' }));
    await clickFoodInputCandidate('杏');
    await user.click(screen.getByRole('button', { name: '+ 加工品を追加' }));
    await user.click(screen.getByRole('button', { name: 'B. 新しい加工品を作る' }));
    await user.type(screen.getByPlaceholderText('例: セミドライ杏'), '新加工品');
    await user.click(screen.getByRole('button', { name: '追加' }));
    await user.click(screen.getByRole('button', { name: '内容を確認' }));
    expect(await screen.findByRole('heading', { name: '杏セミドライを作る' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '加工知識として保存' })).toBeInTheDocument();
  });

  it('13. saving二重送信防止: 保存中はボタンがdisabledになりAPIは1回だけ呼ばれる', async () => {
    const user = userEvent.setup();
    let resolveSave: (v: unknown) => void = () => {};
    createProcessKnowledge.mockReturnValue(new Promise((resolve) => { resolveSave = resolve; }));
    await renderReady();
    await user.type(screen.getByPlaceholderText('例: 杏セミドライを作る'), '杏セミドライを作る');
    await user.click(screen.getByRole('button', { name: '+ 食材・加工品を追加' }));
    await clickFoodInputCandidate('杏');
    await user.click(screen.getByRole('button', { name: '+ 加工品を追加' }));
    await user.click(screen.getByRole('button', { name: 'B. 新しい加工品を作る' }));
    await user.type(screen.getByPlaceholderText('例: セミドライ杏'), '新加工品');
    await user.click(screen.getByRole('button', { name: '追加' }));
    await user.click(screen.getByRole('button', { name: '内容を確認' }));
    const saveBtn = await screen.findByRole('button', { name: '加工知識として保存' });
    await user.click(saveBtn);
    expect(await screen.findByRole('button', { name: '保存中…' })).toBeDisabled();
    expect(createProcessKnowledge).toHaveBeenCalledTimes(1);
    resolveSave({ status: 'success', process: {}, inputs: [], outputs: [], relations: [] });
  });
});
