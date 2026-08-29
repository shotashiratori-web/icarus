import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import WineLinkPicker from '../src/screens/WineLinkPicker';
import type { WineEntity } from '../src/types/wineEntity';

// Tasting Note Persistence v1（Stage 1C-A）。Wine選択UIが「候補提示のみ・自動選択なし」を守り、
// Wine Entity新規作成APIを一切呼ばないことを検証する。

const { fetchWines, createWine } = vi.hoisted(() => ({
  fetchWines: vi.fn(),
  createWine: vi.fn(),
}));
vi.mock('../src/api/wineEntityApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/api/wineEntityApi')>();
  return { ...actual, fetchWines, createWine };
});

function wine(overrides: Partial<WineEntity>): WineEntity {
  return {
    id: overrides.id ?? 'wine-1',
    title: overrides.title ?? 'テストワイン',
    description: '',
    photos: [],
    tags: [],
    status: 'active',
    producer: overrides.producer ?? '',
    vintage: overrides.vintage ?? null,
    variety: '',
    origin: '',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    createdBy: 'staff@example.com',
    ...overrides,
  };
}

describe('WineLinkPicker', () => {
  beforeEach(() => {
    fetchWines.mockReset();
    createWine.mockReset();
  });

  it('起動時にwine_nameがsearch queryへ初期投入される', async () => {
    fetchWines.mockResolvedValue([wine({ id: 'w1', title: 'ナナツモリ', producer: 'ドメーヌ・タカヒコ' })]);
    render(
      <WineLinkPicker
        initialQuery="ナナツモリ"
        producerHint="ドメーヌ・タカヒコ"
        vintageHint=""
        idToken="token"
        onSelect={vi.fn()}
        onClose={vi.fn()}
        onTokenExpired={vi.fn()}
      />,
    );

    expect(screen.getByPlaceholderText('ワイン名・生産者・年で検索')).toHaveValue('ナナツモリ');
    await waitFor(() => expect(screen.getByText('ナナツモリ')).toBeInTheDocument());
  });

  it('13. 同名複数候補は全て一覧表示され、タップするまで確定しない', async () => {
    fetchWines.mockResolvedValue([
      wine({ id: 'w1', title: 'ピノ・ノワール', producer: '山田堂', vintage: 2022 }),
      wine({ id: 'w2', title: 'ピノ・ノワール', producer: 'ノースクリーク ファーム', vintage: 2024 }),
    ]);
    const onSelect = vi.fn();
    render(
      <WineLinkPicker
        initialQuery="ピノ・ノワール"
        producerHint=""
        vintageHint=""
        idToken="token"
        onSelect={onSelect}
        onClose={vi.fn()}
        onTokenExpired={vi.fn()}
      />,
    );

    await waitFor(() => expect(screen.getAllByText('ピノ・ノワール')).toHaveLength(2));
    // 一覧表示のみで自動選択されていない
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('15. 候補が1件でも自動選択されず、明示的にタップして初めてonSelectが呼ばれる', async () => {
    const target = wine({ id: 'only-one', title: 'ユニークワイン', producer: '生産者A', vintage: 2023 });
    fetchWines.mockResolvedValue([target]);
    const onSelect = vi.fn();
    render(
      <WineLinkPicker
        initialQuery="ユニークワイン"
        producerHint="生産者A"
        vintageHint="2023"
        idToken="token"
        onSelect={onSelect}
        onClose={vi.fn()}
        onTokenExpired={vi.fn()}
      />,
    );

    await waitFor(() => expect(screen.getByText('ユニークワイン')).toBeInTheDocument());
    expect(onSelect).not.toHaveBeenCalled(); // 表示されただけでは呼ばれない

    fireEvent.click(screen.getByText('ユニークワイン'));
    expect(onSelect).toHaveBeenCalledWith(target);
  });

  it('16. 検索queryを編集すると候補が絞り込まれる', async () => {
    fetchWines.mockResolvedValue([
      wine({ id: 'w1', title: 'モンロゼ AK', producer: 'ドメーヌ・モン' }),
      wine({ id: 'w2', title: 'アメイセンソウ', producer: 'ランセッカ' }),
    ]);
    render(
      <WineLinkPicker
        initialQuery=""
        producerHint=""
        vintageHint=""
        idToken="token"
        onSelect={vi.fn()}
        onClose={vi.fn()}
        onTokenExpired={vi.fn()}
      />,
    );

    await waitFor(() => expect(screen.getByText('モンロゼ AK')).toBeInTheDocument());
    fireEvent.change(screen.getByPlaceholderText('ワイン名・生産者・年で検索'), { target: { value: 'ランセッカ' } });

    await waitFor(() => {
      expect(screen.queryByText('モンロゼ AK')).not.toBeInTheDocument();
      expect(screen.getByText('アメイセンソウ')).toBeInTheDocument();
    });
  });

  it('18. Wine Entity新規作成API（createWine）は一切呼ばれない', async () => {
    const target = wine({ id: 'w1', title: 'モンロゼ AK', producer: 'ドメーヌ・モン' });
    fetchWines.mockResolvedValue([target]);
    render(
      <WineLinkPicker
        initialQuery="モンロゼ"
        producerHint=""
        vintageHint=""
        idToken="token"
        onSelect={vi.fn()}
        onClose={vi.fn()}
        onTokenExpired={vi.fn()}
      />,
    );

    await waitFor(() => expect(screen.getByText('モンロゼ AK')).toBeInTheDocument());
    fireEvent.click(screen.getByText('モンロゼ AK'));

    expect(createWine).not.toHaveBeenCalled();
  });

  it('該当なしの場合は「見つかりません」を表示する（新規作成は提案しない）', async () => {
    fetchWines.mockResolvedValue([wine({ id: 'w1', title: '無関係' })]);
    render(
      <WineLinkPicker
        initialQuery="存在しないワイン"
        producerHint=""
        vintageHint=""
        idToken="token"
        onSelect={vi.fn()}
        onClose={vi.fn()}
        onTokenExpired={vi.fn()}
      />,
    );

    await waitFor(() => expect(screen.getByText('該当するワインが見つかりません')).toBeInTheDocument());
    expect(screen.queryByText(/新規/)).not.toBeInTheDocument();
  });

  it('producer/vintage欠損のWineでもレイアウトが壊れず表示できる', async () => {
    fetchWines.mockResolvedValue([wine({ id: 'w1', title: '欠損ワイン', producer: '', vintage: null })]);
    render(
      <WineLinkPicker
        initialQuery="欠損"
        producerHint=""
        vintageHint=""
        idToken="token"
        onSelect={vi.fn()}
        onClose={vi.fn()}
        onTokenExpired={vi.fn()}
      />,
    );

    await waitFor(() => expect(screen.getByText('欠損ワイン')).toBeInTheDocument());
  });

  it('← 戻るボタンでonCloseが呼ばれる', async () => {
    fetchWines.mockResolvedValue([]);
    const onClose = vi.fn();
    render(
      <WineLinkPicker
        initialQuery=""
        producerHint=""
        vintageHint=""
        idToken="token"
        onSelect={vi.fn()}
        onClose={onClose}
        onTokenExpired={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByText('← 戻る'));
    expect(onClose).toHaveBeenCalled();
  });
});
