import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import FoodEncyclopediaListScreen from '../src/screens/FoodEncyclopediaListScreen';
import { mockUseAuth } from './testAuth';
import { useFoodEncyclopediaListStore } from '../src/store/foodEncyclopediaListStore';
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

// UX-006検証用。Zustand storeはmodule singletonのため、component側のunmount/remount
// （RTLのcleanupを含む）では初期化されない。testごとに明示的に初期状態へ戻す
function resetStore() {
  useFoodEncyclopediaListStore.setState({
    items: [], loadState: 'idle', errorMessage: '',
    searchQuery: '', largeCategoryFilter: '', scrollPosition: 0,
  });
}

describe('FoodEncyclopediaListScreen', () => {
  beforeEach(() => {
    fetchFieldFoods.mockReset();
    resetStore();
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

// UX-006: Food List State Persistence。
// 「トマト」で検索 → トマトDetail → 玉ねぎDetail(Cross Navigation) → ← 食材図鑑 で
// 検索・カテゴリ・scroll位置がリセットされていた実害への対応
describe('FoodEncyclopediaListScreen UX-006: State Persistence', () => {
  beforeEach(() => {
    fetchFieldFoods.mockReset();
    resetStore();
  });

  it('1. 検索条件がstoreへ保持される', async () => {
    fetchFieldFoods.mockResolvedValue({ items: [listItem('トマト'), listItem('玉ねぎ')], totalCount: 2 });
    render(<FoodEncyclopediaListScreen go={vi.fn()} />);
    const input = await screen.findByPlaceholderText('食材名で検索');

    fireEvent.change(input, { target: { value: 'トマト' } });
    expect(useFoodEncyclopediaListStore.getState().searchQuery).toBe('トマト');
  });

  it('2. カテゴリ絞り込みがstoreへ保持される', async () => {
    fetchFieldFoods.mockResolvedValue({
      items: [listItem('しいたけ', { largeCategory: 'キノコ' }), listItem('トマト', { largeCategory: '植物' })],
      totalCount: 2,
    });
    render(<FoodEncyclopediaListScreen go={vi.fn()} />);
    const button = await screen.findByRole('button', { name: 'キノコ' });

    fireEvent.click(button);
    expect(useFoodEncyclopediaListStore.getState().largeCategoryFilter).toBe('キノコ');
  });

  it('3. 検索+カテゴリを両方保持したまま絞り込める', async () => {
    fetchFieldFoods.mockResolvedValue({
      items: [
        listItem('しいたけ', { largeCategory: 'キノコ' }),
        listItem('なめこ', { largeCategory: 'キノコ' }),
        listItem('トマト', { largeCategory: '植物' }),
      ],
      totalCount: 3,
    });
    render(<FoodEncyclopediaListScreen go={vi.fn()} />);
    await screen.findByText('トマト');

    fireEvent.click(screen.getByRole('button', { name: 'キノコ' }));
    fireEvent.change(screen.getByPlaceholderText('食材名で検索'), { target: { value: 'なめこ' } });

    expect(screen.getByText('なめこ')).toBeInTheDocument();
    expect(screen.queryByText('しいたけ')).not.toBeInTheDocument();
    expect(screen.queryByText('トマト')).not.toBeInTheDocument();
    expect(useFoodEncyclopediaListStore.getState()).toMatchObject({ searchQuery: 'なめこ', largeCategoryFilter: 'キノコ' });
  });

  it('4. List→Detail→Listで検索・カテゴリが復元され、再fetchもされない', async () => {
    fetchFieldFoods.mockResolvedValue({
      items: [listItem('しいたけ', { largeCategory: 'キノコ' }), listItem('トマト', { largeCategory: '植物' })],
      totalCount: 2,
    });
    const { unmount } = render(<FoodEncyclopediaListScreen go={vi.fn()} />);
    await screen.findByText('トマト');
    fireEvent.change(screen.getByPlaceholderText('食材名で検索'), { target: { value: 'しい' } });
    fireEvent.click(screen.getByRole('button', { name: 'キノコ' }));
    unmount(); // Food Detailへ遷移した想定（List画面がアンマウントされる）

    render(<FoodEncyclopediaListScreen go={vi.fn()} />); // Listへ戻ってきた想定
    const input = await screen.findByPlaceholderText('食材名で検索');
    expect(input).toHaveValue('しい');
    // 検索+カテゴリが両方復元された結果、絞り込み後の一覧にも反映されている
    expect(screen.getByText('しいたけ')).toBeInTheDocument();
    expect(screen.queryByText('トマト')).not.toBeInTheDocument();
    expect(fetchFieldFoods).toHaveBeenCalledTimes(1); // 再fetchしていない
  });

  it('5. Cross Navigation経由（複数Detailを経由）でもList状態が保持される', async () => {
    // 実際のCross NavigationはFood Detail同士の遷移で、Listのstoreには一切触れない。
    // ここではList→Detail→(別Detail)→Listという複数回のunmount/remountでも、
    // storeがこのファイル内の関数以外から変更されないことを確認する
    fetchFieldFoods.mockResolvedValue({ items: [listItem('トマト'), listItem('玉ねぎ')], totalCount: 2 });
    const { unmount: unmount1 } = render(<FoodEncyclopediaListScreen go={vi.fn()} />);
    await screen.findByText('玉ねぎ');
    fireEvent.change(screen.getByPlaceholderText('食材名で検索'), { target: { value: 'トマト' } });
    unmount1();

    const { unmount: unmount2 } = render(<FoodEncyclopediaListScreen go={vi.fn()} />);
    expect(await screen.findByPlaceholderText('食材名で検索')).toHaveValue('トマト');
    unmount2();

    render(<FoodEncyclopediaListScreen go={vi.fn()} />);
    expect(await screen.findByPlaceholderText('食材名で検索')).toHaveValue('トマト');
    expect(fetchFieldFoods).toHaveBeenCalledTimes(1);
  });

  // icarus/webはhtml/body/#rootがoverflow:hiddenの固定シェルで、window/documentレベルの
  // スクロールは存在しない（本番実機確認で発覚。window.scrollY/scrollToは常に0でno-op）。
  // 実際にスクロールするのは画面自身の.main要素（overflow-y:auto）のため、以下は
  // window.scrollTo呼び出しの有無ではなく、.main要素の実scrollTopを直接検証する
  function getMain(): HTMLElement {
    return document.querySelector('main') as HTMLElement;
  }

  it('6. 保存済みscroll位置をready後に.main要素のscrollTopへ復元する', async () => {
    fetchFieldFoods.mockResolvedValue({ items: [listItem('トマト')], totalCount: 1 });
    useFoodEncyclopediaListStore.setState({ scrollPosition: 480 });

    render(<FoodEncyclopediaListScreen go={vi.fn()} />);
    await screen.findByText('トマト');

    await vi.waitFor(() => expect(getMain().scrollTop).toBe(480));
  });

  it('7. scroll復元は1回だけ行われ、その後ユーザーが動かした位置を上書きしない', async () => {
    fetchFieldFoods.mockResolvedValue({ items: [listItem('トマト'), listItem('玉ねぎ')], totalCount: 2 });
    useFoodEncyclopediaListStore.setState({ scrollPosition: 300 });

    render(<FoodEncyclopediaListScreen go={vi.fn()} />);
    await screen.findByText('玉ねぎ');
    await vi.waitFor(() => expect(getMain().scrollTop).toBe(300));

    // 復元後にユーザー自身がscrollした位置を、検索等による再描画が勝手に巻き戻さないこと
    getMain().scrollTop = 50;
    fireEvent.change(screen.getByPlaceholderText('食材名で検索'), { target: { value: 'トマト' } });
    expect(screen.getByText('トマト')).toBeInTheDocument();
    expect(getMain().scrollTop).toBe(50);
  });

  it('8. Food card tap時に.main要素の現在のscrollTopがstoreへ保存される', async () => {
    fetchFieldFoods.mockResolvedValue({ items: [listItem('トマト')], totalCount: 1 });
    const go = vi.fn();

    render(<FoodEncyclopediaListScreen go={go} />);
    const card = await screen.findByText('トマト');
    getMain().scrollTop = 777;
    fireEvent.click(card.closest('button')!);

    expect(useFoodEncyclopediaListStore.getState().scrollPosition).toBe(777);
    expect(go).toHaveBeenCalledWith({ name: 'foodEncyclopediaDetail', foodName: 'トマト' });
  });

  it('9. store reset契約: 明示的なreset UI操作をしない限り検索/カテゴリは自動で消えない', async () => {
    fetchFieldFoods.mockResolvedValue({ items: [listItem('トマト'), listItem('玉ねぎ')], totalCount: 2 });
    const { unmount } = render(<FoodEncyclopediaListScreen go={vi.fn()} />);
    await screen.findByText('玉ねぎ');
    fireEvent.change(screen.getByPlaceholderText('食材名で検索'), { target: { value: 'トマト' } });
    unmount();

    render(<FoodEncyclopediaListScreen go={vi.fn()} />);
    expect(await screen.findByPlaceholderText('食材名で検索')).toHaveValue('トマト');

    // ユーザー自身が検索欄をclearすればstoreも追従して空に戻る（専用reset UIは今回追加しない）
    fireEvent.change(screen.getByPlaceholderText('食材名で検索'), { target: { value: '' } });
    expect(useFoodEncyclopediaListStore.getState().searchQuery).toBe('');
  });
});
