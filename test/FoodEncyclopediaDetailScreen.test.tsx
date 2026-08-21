import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';
import FoodEncyclopediaDetailScreen, { buildProcessChains, countProcessChain } from '../src/screens/FoodEncyclopediaDetailScreen';
import { mockUseAuth } from './testAuth';
import type { FieldFoodDetailSuccess, FieldFoodListItem, FieldFoodObservation } from '../src/types/fieldFood';
import type { ProcessEntity, ProcessedProductEntity, FoodEntity } from '../src/types/knowledge';
import type { RelatedProcessGroup, RelatedProcessGroupUse } from '../src/api/knowledgeApi';

vi.mock('../src/context/AuthContext', () => ({ useAuth: () => mockUseAuth() }));

const {
  fetchFieldFoodDetail, resolveFoodByName, fetchRelatedProcesses, fetchAllFoods, fetchFieldFoods,
} = vi.hoisted(() => ({
  fetchFieldFoodDetail: vi.fn(),
  resolveFoodByName: vi.fn(),
  fetchRelatedProcesses: vi.fn(),
  fetchAllFoods: vi.fn(),
  fetchFieldFoods: vi.fn(),
}));
vi.mock('../src/api/fieldFoodApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/api/fieldFoodApi')>();
  return { ...actual, fetchFieldFoodDetail, fetchFieldFoods };
});
vi.mock('../src/api/knowledgeApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/api/knowledgeApi')>();
  return { ...actual, resolveFoodByName, fetchRelatedProcesses, fetchAllFoods };
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

function observation(eventId: string, overrides: Partial<FieldFoodObservation> = {}): FieldFoodObservation {
  return {
    eventId, date: '2026-07-01', photoUrl: '', place: '', memo: '',
    latitude: null, longitude: null, elevation: null, takenAt: null,
    largeCategory: '', subCategory: '', observedParts: '', identificationStatus: '', createdBy: '',
    ...overrides,
  };
}

// Lightbox内のimg（alt=食材名で複数存在しうる、または alt=""で装飾扱い）はrole="img"で一意に拾えないため、
// src属性で直接クリック対象のbuttonを探す（WorkDetailScreen.test.tsxと同じ方針）
function clickPhotoByUrl(url: string) {
  const img = document.querySelector<HTMLImageElement>(`img[src="${url}"]`);
  fireEvent.click(img!.closest('button')!);
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

// group.usesの要素。既存fixtureの大半はFood入力のため既定はtype:'food'
function use(overrides: Partial<RelatedProcessGroupUse> & { id: string; name: string }): RelatedProcessGroupUse {
  return { type: 'food', ...overrides };
}

function foodEntity(overrides: Partial<FoodEntity> & { id: string; canonicalName: string }): FoodEntity {
  return {
    aliases: [], usableParts: [], description: '', createdAt: '', updatedAt: '', createdBy: '', ...overrides,
  };
}

async function renderReady(foodName: string) {
  render(<FoodEncyclopediaDetailScreen go={vi.fn()} foodName={foodName} />);
  // h1(foodName)はheaderのspan(同一テキスト)と別要素なので、role指定で一意に待つ
  await screen.findByRole('heading', { level: 1, name: foodName });
}

// go()呼び出しをtestから検証したい場合用。renderReadyと違い、mock自体を呼び出し元へ返す
async function renderReadyCapturingGo(foodName: string) {
  const go = vi.fn();
  render(<FoodEncyclopediaDetailScreen go={go} foodName={foodName} />);
  await screen.findByRole('heading', { level: 1, name: foodName });
  return go;
}

// loadFoodChipTargets（Cross Navigation解決。候補0件なら fetchAllFoods/fetchFieldFoods を呼ばず
// 即座に空Mapへ倒す設計のため、その呼び出し自体は待機条件にできない）の完了を待つ。
// non-clickableを検証するtestで、解決処理がまだ走っていないだけの「未検証の合格」を防ぐため、
// 必ず呼ばれるfetchRelatedProcessesの完了を確認した上でmicrotask/timerを1周させ、
// resulting setState/re-renderを確定させる
async function flushFoodChipResolution() {
  await vi.waitFor(() => expect(fetchRelatedProcesses).toHaveBeenCalled());
  await new Promise((resolve) => setTimeout(resolve, 0));
}

async function findProcessSection(): Promise<HTMLElement> {
  const heading = await screen.findByRole('heading', { level: 2, name: '加工' });
  return heading.closest('section') as HTMLElement;
}

// Summary cardは見出しを持たないため、常に描画される「観察期間」ラベルを起点にsectionを特定する
function findSummarySection(): HTMLElement {
  return screen.getByText('観察期間').closest('section') as HTMLElement;
}

function findPlaceBreakdownSection(): HTMLElement | null {
  const heading = screen.queryByRole('heading', { level: 2, name: '場所' });
  return heading ? (heading.closest('section') as HTMLElement) : null;
}

describe('FoodEncyclopediaDetailScreen', () => {
  beforeEach(() => {
    fetchFieldFoodDetail.mockReset();
    resolveFoodByName.mockReset();
    fetchRelatedProcesses.mockReset();
    // Food Input Cross Navigation用の追加ロード。個別に検証しないtestでは実ネットワークへ
    // 飛ばさないよう既定で空を返す（＝全chip non-clickableのまま、既存の表示検証には影響しない）
    fetchAllFoods.mockReset().mockResolvedValue([]);
    fetchFieldFoods.mockReset().mockResolvedValue({ items: [], totalCount: 0 });
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
      uses: [use({ id: 'f-tomato', name: 'トマト' }), use({ id: 'f-onion', name: '玉ねぎ' })],
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
        uses: [use({ id: 'f-namako', name: 'ナマコ' })],
        produces: [product({ id: 'prod-yudeta', name: '茹でたナマコ' }), product({ id: 'prod-yudejiru', name: 'ナマコの茹で汁' })],
      },
      {
        process: process({ id: 'proc-shio', name: 'ナマコ塩を作る', steps: [] }),
        uses: [use({ id: 'prod-yudejiru', name: 'ナマコの茹で汁', type: 'processed_product' })],
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
      uses: [use({ id: 'f-tomato', name: 'トマト' }), use({ id: 'f-onion', name: '玉ねぎ' })],
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
      uses: [use({ id: 'f-anzu', name: '杏' })],
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

  it('7. 場所未記入のみのFood: Summaryから「場所」項目自体が消え、内訳は軽い注記のみになる', async () => {
    fetchFieldFoodDetail.mockResolvedValue(detail('ナマコ', {
      places: [{ place: null, observationCount: 1 }],
    }));
    resolveFoodByName.mockResolvedValue(null);
    await renderReady('ナマコ');

    // 「0ヶ所」を出すと、GPSはあるが場所名が無い観察と並んだ時に矛盾して見えるため、0件時はSummary項目ごと非表示にする
    expect(within(findSummarySection()).queryByText('場所')).not.toBeInTheDocument();
    expect(screen.queryByText(/ヶ所/)).not.toBeInTheDocument();
    // 場所未記入は場所名の内訳行(placeList)としては出さない。breakdown sectionの見出し自体は残る
    const placeSection = findPlaceBreakdownSection();
    expect(placeSection).not.toBeNull();
    expect(within(placeSection as HTMLElement).queryByText('場所未記入')).not.toBeInTheDocument();
    expect(within(placeSection as HTMLElement).getByText('場所未記入 1件')).toBeInTheDocument();
  });

  it('8. 名前付きの場所と場所未記入が混在するFood: Summaryは名前付きのみを数え、内訳と注記が両方出る', async () => {
    fetchFieldFoodDetail.mockResolvedValue(detail('トマト', {
      places: [
        { place: '早苗ヶ丘', observationCount: 3 },
        { place: null, observationCount: 2 },
      ],
    }));
    resolveFoodByName.mockResolvedValue(null);
    await renderReady('トマト');

    expect(screen.getByText('1ヶ所')).toBeInTheDocument();
    expect(screen.getByText('早苗ヶ丘')).toBeInTheDocument();
    expect(screen.queryByText('場所未記入')).not.toBeInTheDocument();
    expect(screen.getByText('場所未記入 2件')).toBeInTheDocument();
  });

  it('9. すべて名前付きの場所のFood: 注記は出ず、内訳のみ表示される', async () => {
    fetchFieldFoodDetail.mockResolvedValue(detail('トマト', {
      places: [{ place: '早苗ヶ丘', observationCount: 5 }],
    }));
    resolveFoodByName.mockResolvedValue(null);
    await renderReady('トマト');

    expect(screen.getByText('1ヶ所')).toBeInTheDocument();
    expect(screen.getByText('早苗ヶ丘')).toBeInTheDocument();
    // 観察記録側の個別カードには元々「📍 場所未記入」が出うるため、breakdown section内だけを確認する
    expect(within(findPlaceBreakdownSection() as HTMLElement).queryByText(/場所未記入/)).not.toBeInTheDocument();
  });

  it('10. 観察部位0件のFood: Summaryから「観察部位」項目が消える', async () => {
    fetchFieldFoodDetail.mockResolvedValue(detail('ナマコ', {
      food: listItem('ナマコ', { partCount: 0 }),
    }));
    resolveFoodByName.mockResolvedValue(null);
    await renderReady('ナマコ');

    expect(within(findSummarySection()).queryByText('観察部位')).not.toBeInTheDocument();
  });

  it('11. 観察部位ありのFood: Summaryに「観察部位」項目が出る', async () => {
    fetchFieldFoodDetail.mockResolvedValue(detail('トマト', {
      food: listItem('トマト', { partCount: 2 }),
    }));
    resolveFoodByName.mockResolvedValue(null);
    await renderReady('トマト');

    const summarySection = findSummarySection();
    expect(within(summarySection).getByText('観察部位')).toBeInTheDocument();
    expect(within(summarySection).getByText('2')).toBeInTheDocument();
  });

  it('12. Summary項目数: 加工なし(観察記録・観察期間のみ想定)でも加工なし/加工ありでSummary自体は常に描画される', async () => {
    fetchFieldFoodDetail.mockResolvedValue(detail('カタクリ', {
      food: listItem('カタクリ', { placeCount: 0, partCount: 0 }),
      places: [],
    }));
    resolveFoodByName.mockResolvedValue(null);
    await renderReady('カタクリ');

    // 場所・観察部位・加工がすべて0件でも、観察記録・観察期間は常に表示される
    const summarySection = findSummarySection();
    expect(within(summarySection).getByText('観察記録')).toBeInTheDocument();
    expect(within(summarySection).getByText('観察期間')).toBeInTheDocument();
    expect(within(summarySection).queryByText('場所')).not.toBeInTheDocument();
    expect(within(summarySection).queryByText('観察部位')).not.toBeInTheDocument();
    expect(within(summarySection).queryByText('加工')).not.toBeInTheDocument();
  });
});

describe('FoodEncyclopediaDetailScreen Lightbox（Stage B: Work Detailと共有）', () => {
  beforeEach(() => {
    fetchFieldFoodDetail.mockReset();
    resolveFoodByName.mockReset();
    fetchRelatedProcesses.mockReset();
    resolveFoodByName.mockResolvedValue(null);
    fetchAllFoods.mockReset().mockResolvedValue([]);
    fetchFieldFoods.mockReset().mockResolvedValue({ items: [], totalCount: 0 });
  });

  it('1. Hero写真click → index0でLightboxが開く', async () => {
    fetchFieldFoodDetail.mockResolvedValue(detail('トマト', {
      food: listItem('トマト', { representativePhotoUrl: 'https://x.test/hero.jpg' }),
      observations: [
        observation('e1', { date: '2026-07-03', photoUrl: 'https://x.test/hero.jpg' }),
        observation('e2', { date: '2026-07-02', photoUrl: 'https://x.test/2.jpg' }),
      ],
    }));
    await renderReady('トマト');

    clickPhotoByUrl('https://x.test/hero.jpg');
    expect(screen.getByText('1 / 2')).toBeInTheDocument();
  });

  it('2. Observation写真click → その写真のindexでLightboxが開く', async () => {
    fetchFieldFoodDetail.mockResolvedValue(detail('トマト', {
      food: listItem('トマト', { representativePhotoUrl: 'https://x.test/hero.jpg' }),
      observations: [
        observation('e1', { date: '2026-07-03', photoUrl: 'https://x.test/hero.jpg' }),
        observation('e2', { date: '2026-07-02', photoUrl: 'https://x.test/2.jpg' }),
        observation('e3', { date: '2026-07-01', photoUrl: 'https://x.test/3.jpg' }),
      ],
    }));
    await renderReady('トマト');

    clickPhotoByUrl('https://x.test/3.jpg');
    expect(screen.getByText('3 / 3')).toBeInTheDocument();
  });

  it('3. HeroとObservationが同一URL → galleryでは重複排除されて1件になる', async () => {
    fetchFieldFoodDetail.mockResolvedValue(detail('トマト', {
      food: listItem('トマト', { representativePhotoUrl: 'https://x.test/same.jpg' }),
      observations: [
        // e1はHeroと同じURL（Heroは「写真つき最新観察」から選ばれるため、通常はこの形になる）
        observation('e1', { date: '2026-07-03', photoUrl: 'https://x.test/same.jpg' }),
        observation('e2', { date: '2026-07-02', photoUrl: 'https://x.test/2.jpg' }),
      ],
    }));
    await renderReady('トマト');

    // 重複排除されていれば全体2件（Hero分を二重に数えない）
    clickPhotoByUrl('https://x.test/2.jpg');
    expect(screen.getByText('2 / 2')).toBeInTheDocument();

    // Heroと同一URLの観察写真をclickしても、Heroと同じ1件目として開く（別枠にならない）
    fireEvent.keyDown(window, { key: 'Escape' });
    clickPhotoByUrl('https://x.test/same.jpg');
    expect(screen.getByText('1 / 2')).toBeInTheDocument();
  });

  it('4. 複数写真: next/previousで移動できる', async () => {
    fetchFieldFoodDetail.mockResolvedValue(detail('トマト', {
      food: listItem('トマト', { representativePhotoUrl: null }),
      observations: [
        observation('e1', { date: '2026-07-03', photoUrl: 'https://x.test/1.jpg' }),
        observation('e2', { date: '2026-07-02', photoUrl: 'https://x.test/2.jpg' }),
        observation('e3', { date: '2026-07-01', photoUrl: 'https://x.test/3.jpg' }),
      ],
    }));
    await renderReady('トマト');

    clickPhotoByUrl('https://x.test/1.jpg');
    expect(screen.getByText('1 / 3')).toBeInTheDocument();
    expect(screen.queryByLabelText('前の写真')).not.toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('次の写真'));
    expect(screen.getByText('2 / 3')).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('前の写真'));
    expect(screen.getByText('1 / 3')).toBeInTheDocument();
  });

  it('5. Escで閉じる', async () => {
    fetchFieldFoodDetail.mockResolvedValue(detail('トマト', {
      food: listItem('トマト', { representativePhotoUrl: null }),
      observations: [observation('e1', { photoUrl: 'https://x.test/1.jpg' })],
    }));
    await renderReady('トマト');

    clickPhotoByUrl('https://x.test/1.jpg');
    expect(screen.getByText('1 / 1')).toBeInTheDocument();

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByText('1 / 1')).not.toBeInTheDocument();
  });

  it('6. 写真1枚だけでもHero clickでLightboxが開く', async () => {
    fetchFieldFoodDetail.mockResolvedValue(detail('カタクリ', {
      food: listItem('カタクリ', { representativePhotoUrl: 'https://x.test/only.jpg' }),
      observations: [observation('e1', { photoUrl: 'https://x.test/only.jpg' })],
    }));
    await renderReady('カタクリ');

    clickPhotoByUrl('https://x.test/only.jpg');
    expect(screen.getByText('1 / 1')).toBeInTheDocument();
    expect(screen.queryByLabelText('前の写真')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('次の写真')).not.toBeInTheDocument();
  });
});

describe('Food Input Cross Navigation（Stage C）', () => {
  beforeEach(() => {
    fetchFieldFoodDetail.mockReset();
    resolveFoodByName.mockReset();
    fetchRelatedProcesses.mockReset();
    fetchAllFoods.mockReset();
    fetchFieldFoods.mockReset();
  });

  it('1. canonical exact解決: 他Food chipがclickableになり、tapで解決先のfoodEncyclopediaDetailへ遷移する（トマト→玉ねぎ）', async () => {
    fetchFieldFoodDetail.mockResolvedValue(detail('トマト'));
    resolveFoodByName.mockResolvedValue(foodEntity({ id: 'f-tomato', canonicalName: 'トマト' }));
    fetchRelatedProcesses.mockResolvedValue([{
      process: process({ id: 'proc-ketchup', name: 'トマトケチャップを作る' }),
      uses: [use({ id: 'f-tomato', name: 'トマト' }), use({ id: 'f-onion', name: '玉ねぎ' })],
      produces: [product({ id: 'prod-ketchup', name: 'トマトケチャップ' })],
    }]);
    fetchAllFoods.mockResolvedValue([
      foodEntity({ id: 'f-tomato', canonicalName: 'トマト' }),
      foodEntity({ id: 'f-onion', canonicalName: '玉ねぎ' }),
    ]);
    fetchFieldFoods.mockResolvedValue({ items: [listItem('トマト'), listItem('玉ねぎ')], totalCount: 2 });
    const go = await renderReadyCapturingGo('トマト');
    await findProcessSection();

    const chip = await screen.findByRole('button', { name: /玉ねぎ/ });
    fireEvent.click(chip);
    expect(go).toHaveBeenCalledWith({ name: 'foodEncyclopediaDetail', foodName: '玉ねぎ' });
  });

  it('2. 現在Foodのchipはnon-clickable（同じ画面への再遷移を避ける）', async () => {
    fetchFieldFoodDetail.mockResolvedValue(detail('トマト'));
    resolveFoodByName.mockResolvedValue(foodEntity({ id: 'f-tomato', canonicalName: 'トマト' }));
    fetchRelatedProcesses.mockResolvedValue([{
      process: process({ id: 'proc-ketchup', name: 'トマトケチャップを作る' }),
      uses: [use({ id: 'f-tomato', name: 'トマト' })],
      produces: [],
    }]);
    fetchAllFoods.mockResolvedValue([foodEntity({ id: 'f-tomato', canonicalName: 'トマト' })]);
    fetchFieldFoods.mockResolvedValue({ items: [listItem('トマト')], totalCount: 1 });
    await renderReadyCapturingGo('トマト');
    const section = await findProcessSection();
    await flushFoodChipResolution();

    expect(within(section).getByText('トマト')).toBeInTheDocument();
    expect(within(section).queryByRole('button')).not.toBeInTheDocument();
  });

  it('3. ProcessedProductのchipはnon-clickable（専用Detail未実装のため）', async () => {
    fetchFieldFoodDetail.mockResolvedValue(detail('ナマコ'));
    resolveFoodByName.mockResolvedValue(foodEntity({ id: 'f-namako', canonicalName: 'ナマコ' }));
    fetchRelatedProcesses.mockResolvedValue([
      {
        process: process({ id: 'proc-yuderu', name: 'ナマコを茹でる' }),
        uses: [use({ id: 'f-namako', name: 'ナマコ' })],
        produces: [product({ id: 'prod-yudejiru', name: 'ナマコの茹で汁' })],
      },
      {
        process: process({ id: 'proc-shio', name: 'ナマコ塩を作る' }),
        uses: [use({ id: 'prod-yudejiru', name: 'ナマコの茹で汁', type: 'processed_product' })],
        produces: [product({ id: 'prod-shio', name: 'ナマコ塩' })],
      },
    ]);
    fetchAllFoods.mockResolvedValue([foodEntity({ id: 'f-namako', canonicalName: 'ナマコ' })]);
    fetchFieldFoods.mockResolvedValue({ items: [listItem('ナマコ')], totalCount: 1 });
    await renderReadyCapturingGo('ナマコ');
    await findProcessSection();
    await flushFoodChipResolution();

    // 「ナマコの茹で汁」はroot processのできたもの・descendant processの入力の2箇所に出る
    expect(screen.getAllByText('ナマコの茹で汁')).toHaveLength(2);
    expect(screen.queryByRole('button', { name: /ナマコの茹で汁/ })).not.toBeInTheDocument();
  });

  it('4. Field Logに候補が存在しない他Foodのchipはnon-clickable（候補0件）', async () => {
    fetchFieldFoodDetail.mockResolvedValue(detail('トマト'));
    resolveFoodByName.mockResolvedValue(foodEntity({ id: 'f-tomato', canonicalName: 'トマト' }));
    fetchRelatedProcesses.mockResolvedValue([{
      process: process({ id: 'proc-x', name: 'X' }),
      uses: [use({ id: 'f-tomato', name: 'トマト' }), use({ id: 'f-mystery', name: '謎の野菜' })],
      produces: [],
    }]);
    fetchAllFoods.mockResolvedValue([
      foodEntity({ id: 'f-tomato', canonicalName: 'トマト' }),
      foodEntity({ id: 'f-mystery', canonicalName: '謎の野菜' }),
    ]);
    fetchFieldFoods.mockResolvedValue({ items: [listItem('トマト')], totalCount: 1 }); // 謎の野菜はField Logに無い
    await renderReadyCapturingGo('トマト');
    const section = await findProcessSection();
    await flushFoodChipResolution();

    expect(within(section).getByText('謎の野菜')).toBeInTheDocument();
    expect(within(section).queryByRole('button', { name: /謎の野菜/ })).not.toBeInTheDocument();
  });

  it('5. alias一致が複数あるFoodのchipはnon-clickable（曖昧なら決めない）', async () => {
    fetchFieldFoodDetail.mockResolvedValue(detail('トマト'));
    resolveFoodByName.mockResolvedValue(foodEntity({ id: 'f-tomato', canonicalName: 'トマト' }));
    fetchRelatedProcesses.mockResolvedValue([{
      process: process({ id: 'proc-x', name: 'X' }),
      uses: [use({ id: 'f-tomato', name: 'トマト' }), use({ id: 'f-ambiguous', name: 'あいまい' })],
      produces: [],
    }]);
    fetchAllFoods.mockResolvedValue([
      foodEntity({ id: 'f-tomato', canonicalName: 'トマト' }),
      foodEntity({ id: 'f-ambiguous', canonicalName: 'あいまい', aliases: ['あいまいA', 'あいまいB'] }),
    ]);
    // canonical「あいまい」自体はField Logに無く、aliasが2件ヒットする
    fetchFieldFoods.mockResolvedValue({
      items: [listItem('トマト'), listItem('あいまいA'), listItem('あいまいB')], totalCount: 3,
    });
    await renderReadyCapturingGo('トマト');
    const section = await findProcessSection();
    await flushFoodChipResolution();

    expect(within(section).getByText('あいまい')).toBeInTheDocument();
    expect(within(section).queryByRole('button', { name: /あいまい/ })).not.toBeInTheDocument();
  });

  it('6. 杏→アンズ: canonicalがField Logに無くaliasが1件一致する場合、alias名でclickableになる', async () => {
    fetchFieldFoodDetail.mockResolvedValue(detail('トマト'));
    resolveFoodByName.mockResolvedValue(foodEntity({ id: 'f-tomato', canonicalName: 'トマト' }));
    fetchRelatedProcesses.mockResolvedValue([{
      process: process({ id: 'proc-semidry', name: '杏セミドライを作る' }),
      uses: [use({ id: 'f-tomato', name: 'トマト' }), use({ id: 'f-anzu', name: '杏' })],
      produces: [],
    }]);
    fetchAllFoods.mockResolvedValue([
      foodEntity({ id: 'f-tomato', canonicalName: 'トマト' }),
      foodEntity({ id: 'f-anzu', canonicalName: '杏', aliases: ['アンズ'] }),
    ]);
    fetchFieldFoods.mockResolvedValue({ items: [listItem('トマト'), listItem('アンズ')], totalCount: 2 }); // 「杏」自体はField Logに無い
    const go = await renderReadyCapturingGo('トマト');
    await findProcessSection();

    const chip = await screen.findByRole('button', { name: /杏/ });
    fireEvent.click(chip);
    expect(go).toHaveBeenCalledWith({ name: 'foodEncyclopediaDetail', foodName: 'アンズ' });
  });
});

describe('buildProcessChains / countProcessChain（純粋関数の直接テスト）', () => {
  it('cycle安全性: 不正な循環データを与えてもハングせず、逆流分を含めない', () => {
    // A(uses:x, produces:b) → B(uses:b, produces:x) という不正データ（Bがxを再produceする）
    const groups: RelatedProcessGroup[] = [
      { process: process({ id: 'PA', name: 'A' }), uses: [use({ id: 'x', name: 'x' })], produces: [product({ id: 'b', name: 'b' })] },
      { process: process({ id: 'PB', name: 'B' }), uses: [use({ id: 'b', name: 'b', type: 'processed_product' })], produces: [product({ id: 'x', name: 'x' })] },
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
      { process: process({ id: 'R1', name: 'root1' }), uses: [use({ id: 'food', name: 'Food' })], produces: [product({ id: 'p1', name: 'p1' })] },
      { process: process({ id: 'R2', name: 'root2' }), uses: [use({ id: 'food', name: 'Food' })], produces: [product({ id: 'p2', name: 'p2' })] },
      { process: process({ id: 'C', name: 'C' }), uses: [use({ id: 'p1', name: 'p1', type: 'processed_product' }), use({ id: 'p2', name: 'p2', type: 'processed_product' })], produces: [] },
    ];
    const chains = buildProcessChains(groups, 'food');
    expect(chains).toHaveLength(2);
    const totalDescendants = chains[0].descendants.length + chains[1].descendants.length;
    expect(totalDescendants).toBe(1); // Cはどちらか一方のbranchにのみ出現
    expect(countProcessChain(chains)).toBe(3); // root1 + root2 + C
  });
});
