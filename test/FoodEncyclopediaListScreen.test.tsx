import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import FoodEncyclopediaListScreen from '../src/screens/FoodEncyclopediaListScreen';
import { mockUseAuth } from './testAuth';
import type { FieldFoodListItem } from '../src/types/fieldFood';

vi.mock('../src/context/AuthContext', () => ({ useAuth: () => mockUseAuth() }));

const { fetchFieldFoods } = vi.hoisted(() => ({ fetchFieldFoods: vi.fn() }));
vi.mock('../src/api/fieldFoodApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/api/fieldFoodApi')>();
  return { ...actual, fetchFieldFoods };
});

function listItem(foodName: string, overrides: Partial<FieldFoodListItem> = {}): FieldFoodListItem {
  return {
    foodName,
    representativePhotoUrl: null,
    largeCategory: null,
    subCategory: null,
    classificationConflict: false,
    observationCount: 1,
    firstObservedDate: '2026-07-01',
    lastObservedDate: '2026-07-01',
    placeCount: 1,
    partCount: 0,
    ...overrides,
  };
}

describe('FoodEncyclopediaListScreen', () => {
  beforeEach(() => {
    fetchFieldFoods.mockReset();
  });

  it('UX-001: ロード中も検索inputが常にマウントされている', () => {
    fetchFieldFoods.mockReturnValue(new Promise(() => {})); // 未解決のまま = ロード中を維持
    render(<FoodEncyclopediaListScreen go={vi.fn()} />);

    expect(screen.getByPlaceholderText('食材名で検索')).toBeInTheDocument();
  });

  it('UX-001: ロード中に入力した検索語が失われず、データ到着後に反映される', async () => {
    let resolveLoad: (v: { items: FieldFoodListItem[]; totalCount: number }) => void;
    fetchFieldFoods.mockReturnValue(new Promise((resolve) => { resolveLoad = resolve; }));
    render(<FoodEncyclopediaListScreen go={vi.fn()} />);

    const input = screen.getByPlaceholderText('食材名で検索');
    fireEvent.change(input, { target: { value: 'トマト' } });
    expect(input).toHaveValue('トマト');

    resolveLoad!({ items: [listItem('トマト'), listItem('玉ねぎ')], totalCount: 2 });

    expect(await screen.findByText('トマト')).toBeInTheDocument();
    expect(screen.queryByText('玉ねぎ')).not.toBeInTheDocument();
    expect(input).toHaveValue('トマト');
  });

  it('データ取得後、通常の検索入力でも絞り込みができる', async () => {
    fetchFieldFoods.mockResolvedValue({ items: [listItem('トマト'), listItem('玉ねぎ')], totalCount: 2 });
    const user = userEvent.setup();
    render(<FoodEncyclopediaListScreen go={vi.fn()} />);

    await screen.findByText('玉ねぎ');
    const input = screen.getByPlaceholderText('食材名で検索');
    await user.type(input, 'トマト');

    expect(screen.getByText('トマト')).toBeInTheDocument();
    expect(screen.queryByText('玉ねぎ')).not.toBeInTheDocument();
  });
});
