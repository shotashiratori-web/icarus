import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import FoodEncyclopediaDetailScreen, { buildProcessChains, countProcessChain } from '../src/screens/FoodEncyclopediaDetailScreen';
import { mockUseAuth } from './testAuth';
import type { FieldFoodDetailSuccess, FieldFoodListItem } from '../src/types/fieldFood';
import type { ProcessEntity, ProcessedProductEntity } from '../src/types/knowledge';
import type { RelatedProcessGroup } from '../src/api/knowledgeApi';

vi.mock('../src/context/AuthContext', () => ({ useAuth: () => mockUseAuth() }));

const { fetchFieldFoodDetail, resolveFoodByName, fetchRelatedProcesses } = vi.hoisted(() => ({
  fetchFieldFoodDetail: vi.fn(),
  resolveFoodByName: vi.fn(),
  fetchRelatedProcesses: vi.fn(),
}));
vi.mock('../src/api/fieldFoodApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/api/fieldFoodApi')>();
  return { ...actual, fetchFieldFoodDetail };
});
vi.mock('../src/api/knowledgeApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/api/knowledgeApi')>();
  return { ...actual, resolveFoodByName, fetchRelatedProcesses };
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

function detail(foodName: string, overrides: Partial<FieldFoodDetailSuccess> = {}): FieldFoodDetailSuccess {
  return {
    status: 'success',
    food: listItem(foodName),
    observations: [{
      eventId: 'e1', date: '2026-07-01', photoUrl: '', place: '', memo: '',
      latitude: null, longitude: null, elevation: null, takenAt: null,
      largeCategory: '', subCategory: '', observedParts: '', identificationStatus: '', createdBy: '',
    }],
    observedDates: [{ date: '2026-07-01', count: 1 }],
    places: [],
    parts: [],
    pagination: { limit: 50, offset: 0, total: 1 },
    ...overrides,
  };
}

function process(overrides: Partial<ProcessEntity>): ProcessEntity {
  return {
    id: 'proc-' + Math.random(), name: '', description: '', steps: [],
    createdAt: '', updatedAt: '', createdBy: '', ...overrides,
  };
}

function product(overrides: Partial<ProcessedProductEntity>): ProcessedProductEntity {
  return {
    id: 'prod-' + Math.random(), name: '', description: '',
    createdAt: '', updatedAt: '', createdBy: '', ...overrides,
  };
}

async function renderReady(foodName: string) {
  render(<FoodEncyclopediaDetailScreen go={vi.fn()} foodName={foodName} />);
  // h1(foodName)はheaderのspan(同一テキスト)と別要素なので、role指定で一意に待つ
  await screen.findByRole('heading', { level: 1, name: foodName });
}

async function findProcessSection(): Promise<HTMLElement> {
  const heading = await screen.findByRole('heading', { level: 2, name: '加工' });
  return heading.closest('section') as HTMLElement;
}

describe('FoodEncyclopediaDetailScreen', () => {
  beforeEach(() => {
    fetchFieldFoodDetail.mockReset();
    resolveFoodByName.mockReset();
    fetchRelatedProcesses.mockReset();
  });

  it('1. KnowledgeなしFood: 加工sectionが非表示でも観察本体は正常表示される', async () => {
    fetchFieldFoodDetail.mockResolvedValue(detail('カタクリ', { food: listItem('カタクリ', { observationCount: 5 }) }));
    resolveFoodByName.mockResolvedValue(null); // Food Entity未登録
    await renderReady('カタクリ');

    expect(screen.getByRole('heading', { level: 2, name: '観察記録' })).toBeInTheDocument();
    expect(screen.getByText('5件')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 2, name: '加工' })).not.toBeInTheDocument();
    expect(screen.queryByText(/加工.*0件/)).not.toBeInTheDocument();
  });

  it('2. root Process: 加工sectionにProcess名・入力・できたもの・Summary件数が表示され、descriptionは非表示', async () => {
    fetchFieldFoodDetail.mockResolvedValue(detail('トマト', { food: listItem('トマト', { observationCount: 9 }) }));
    resolveFoodByName.mockResolvedValue({ id: 'f-tomato', canonicalName: 'トマト', aliases: [], usableParts: [], description: '', createdAt: '', updatedAt: '', createdBy: '' });
    const groups: RelatedProcessGroup[] = [{
      process: process({ id: 'proc-ketchup', name: 'トマトケチャップを作る', description: '今回Knowledge Graphの主要InputをArchitecture上限定する注記', steps: [] }),
      uses: [{ id: 'f-tomato', name: 'トマト' }, { id: 'f-onion', name: '玉ねぎ' }],
      produces: [product({ id: 'prod-ketchup', name: 'トマトケチャップ', description: 'システム設計上のメモ' })],
    }];
    fetchRelatedProcesses.mockResolvedValue(groups);
    await renderReady('トマト');

    await findProcessSection();
    expect(screen.getByText('トマトケチャップを作る')).toBeInTheDocument();
    expect(screen.getByText('入力:')).toBeInTheDocument();
    expect(screen.getByText('できたもの:')).toBeInTheDocument();
    expect(screen.getByText('トマトケチャップ')).toBeInTheDocument();
    expect(screen.getByText('1件')).toBeInTheDocument(); // Summary「加工」(観察記録は9件で区別)
    expect(screen.getByText('9件')).toBeInTheDocument(); // Summary「観察記録」

    // Process/ProcessedProductのdescriptionは非表示（Content Curation未整備のため）
    expect(screen.queryByText(/Knowledge Graph/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Architecture/)).not.toBeInTheDocument();
    expect(screen.queryByText('システム設計上のメモ')).not.toBeInTheDocument();
  });

  it('3. descendant Process: ナマコ2段chainがroot直下に1回だけ表示され、stepsも表示される', async () => {
    fetchFieldFoodDetail.mockResolvedValue(detail('ナマコ'));
    resolveFoodByName.mockResolvedValue({ id: 'f-namako', canonicalName: 'ナマコ', aliases: [], usableParts: [], description: '', createdAt: '', updatedAt: '', createdBy: '' });
    const groups: RelatedProcessGroup[] = [
      {
        process: process({ id: 'proc-yuderu', name: 'ナマコを茹でる', steps: [{ order: 1, text: '海水で20分沸騰させて茹でる' }] }),
        uses: [{ id: 'f-namako', name: 'ナマコ' }],
        produces: [product({ id: 'prod-yudeta', name: '茹でたナマコ' }), product({ id: 'prod-yudejiru', name: 'ナマコの茹で汁' })],
      },
      {
        process: process({ id: 'proc-shio', name: 'ナマコ塩を作る', steps: [] }),
        uses: [{ id: 'prod-yudejiru', name: 'ナマコの茹で汁' }],
        produces: [product({ id: 'prod-shio', name: 'ナマコ塩' })],
      },
    ];
    fetchRelatedProcesses.mockResolvedValue(groups);
    await renderReady('ナマコ');

    await findProcessSection();
    expect(screen.getByText('ナマコを茹でる')).toBeInTheDocument();
    expect(screen.getByText('↓ さらに加工')).toBeInTheDocument();
    expect(screen.getAllByText('ナマコ塩を作る')).toHaveLength(1);
    expect(screen.getByText('2件')).toBeInTheDocument(); // Summary「加工」
    // steps確認（rootのsteps 1件。descendantはsteps=[]で工程ブロック自体を出さない設計）
    expect(screen.getByText('工程')).toBeInTheDocument();
    expect(screen.getByText('海水で20分沸騰させて茹でる')).toBeInTheDocument();
  });

  it('4. 複数Input: トマトケチャップの入力にトマト・玉ねぎ両方が加工section内に存在する', async () => {
    fetchFieldFoodDetail.mockResolvedValue(detail('トマト'));
    resolveFoodByName.mockResolvedValue({ id: 'f-tomato', canonicalName: 'トマト', aliases: [], usableParts: [], description: '', createdAt: '', updatedAt: '', createdBy: '' });
    const groups: RelatedProcessGroup[] = [{
      process: process({ id: 'proc-ketchup', name: 'トマトケチャップを作る' }),
      uses: [{ id: 'f-tomato', name: 'トマト' }, { id: 'f-onion', name: '玉ねぎ' }],
      produces: [product({ id: 'prod-ketchup', name: 'トマトケチャップ' })],
    }];
    fetchRelatedProcesses.mockResolvedValue(groups);
    await renderReady('トマト');

    const section = await findProcessSection();
    // headerのタイトルspanにも同じ「トマト」テキストがあるため、加工section内に限定して検証する
    expect(within(section).getByText('トマト')).toBeInTheDocument();
    expect(within(section).getByText('玉ねぎ')).toBeInTheDocument();
  });

  it('5. alias Food: 見出しは「アンズ」のまま、入力chipはconfirmed alias解決先の「杏」', async () => {
    fetchFieldFoodDetail.mockResolvedValue(detail('アンズ'));
    resolveFoodByName.mockResolvedValue({ id: 'f-anzu', canonicalName: '杏', aliases: ['アンズ'], usableParts: [], description: '', createdAt: '', updatedAt: '', createdBy: '' });
    const groups: RelatedProcessGroup[] = [{
      process: process({ id: 'proc-semidry', name: '杏セミドライを作る' }),
      uses: [{ id: 'f-anzu', name: '杏' }],
      produces: [product({ id: 'prod-semidry', name: 'セミドライ杏' })],
    }];
    fetchRelatedProcesses.mockResolvedValue(groups);
    await renderReady('アンズ');
    await findProcessSection();

    expect(screen.getByRole('heading', { level: 1, name: 'アンズ' })).toBeInTheDocument();
    expect(screen.getByText('杏セミドライを作る')).toBeInTheDocument();
    expect(screen.getByText('杏')).toBeInTheDocument();
    expect(screen.queryByText(/Food Entity/)).not.toBeInTheDocument();
    expect(screen.queryByText(/canonical/)).not.toBeInTheDocument();
  });

  it('6. Knowledge取得失敗時も観察本体は正常表示され、加工sectionは非表示のまま', async () => {
    fetchFieldFoodDetail.mockResolvedValue(detail('トマト'));
    resolveFoodByName.mockRejectedValue(new Error('network error'));
    await renderReady('トマト');
    await vi.waitFor(() => expect(resolveFoodByName).toHaveBeenCalled());

    expect(screen.getByRole('heading', { level: 2, name: '観察記録' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 2, name: '加工' })).not.toBeInTheDocument();
  });
});

describe('buildProcessChains / countProcessChain（純粋関数の直接テスト）', () => {
  it('cycle安全性: 不正な循環データを与えてもハングせず、逆流分を含めない', () => {
    // A(uses:x, produces:b) → B(uses:b, produces:x) という不正データ（Bがxを再produceする）
    const groups: RelatedProcessGroup[] = [
      { process: process({ id: 'PA', name: 'A' }), uses: [{ id: 'x', name: 'x' }], produces: [product({ id: 'b', name: 'b' })] },
      { process: process({ id: 'PB', name: 'B' }), uses: [{ id: 'b', name: 'b' }], produces: [product({ id: 'x', name: 'x' })] },
    ];
    const chains = buildProcessChains(groups, 'x');
    expect(countProcessChain(chains)).toBe(2); // A→Bのみ、Aへの逆流は含まない
    expect(chains).toHaveLength(1);
    expect(chains[0].descendants).toHaveLength(1);
    expect(chains[0].descendants[0].descendants).toHaveLength(0); // 逆流でAが再度子にならない
  });

  it('複数root合流時、descendantがページ全体で重複しない', () => {
    // Food Aから見てroot1・root2が両方存在し、どちらも同じdescendant Cへ合流するケース
    const groups: RelatedProcessGroup[] = [
      { process: process({ id: 'R1', name: 'root1' }), uses: [{ id: 'food', name: 'Food' }], produces: [product({ id: 'p1', name: 'p1' })] },
      { process: process({ id: 'R2', name: 'root2' }), uses: [{ id: 'food', name: 'Food' }], produces: [product({ id: 'p2', name: 'p2' })] },
      { process: process({ id: 'C', name: 'C' }), uses: [{ id: 'p1', name: 'p1' }, { id: 'p2', name: 'p2' }], produces: [] },
    ];
    const chains = buildProcessChains(groups, 'food');
    expect(chains).toHaveLength(2);
    const totalDescendants = chains[0].descendants.length + chains[1].descendants.length;
    expect(totalDescendants).toBe(1); // Cはどちらか一方のbranchにのみ出現
    expect(countProcessChain(chains)).toBe(3); // root1 + root2 + C
  });
});
