import { describe, expect, it, vi, beforeEach } from 'vitest';
import { resolveFoodByName, FoodAliasConflictError, fetchRelatedProcesses } from '../src/api/knowledgeApi';
import type { FoodEntity, ProcessEntity, ProcessedProductEntity, KnowledgeRelation } from '../src/types/knowledge';

// resolveFoodByName()自体の解決ロジック（canonical優先・confirmed alias exact・conflict時は安全側でthrow）を
// 直接検証する。GET /foods?q=はLIKE検索（曖昧一致）なので、返ってきた候補に対しexact matchを
// 再検証していることが本質的な契約。本番Workerへは通信しない（globalのfetchをmock）
function mockFoodsResponse(items: unknown[]) {
  global.fetch = vi.fn().mockResolvedValue({
    status: 200,
    json: async () => ({ status: 'success', items }),
  }) as unknown as typeof fetch;
}

const 杏 = { id: 'f1', canonicalName: '杏', aliases: ['アンズ'], usableParts: [], description: '', createdAt: '', updatedAt: '', createdBy: '' };

describe('resolveFoodByName', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('14. canonical exactでKnowledge解決できる', async () => {
    mockFoodsResponse([杏]);
    const result = await resolveFoodByName('杏', 'token');
    expect(result?.id).toBe('f1');
  });

  it('15. confirmed alias exactでKnowledge解決できる（Field Log「アンズ」→Food「杏」）', async () => {
    mockFoodsResponse([杏]);
    const result = await resolveFoodByName('アンズ', 'token');
    expect(result?.id).toBe('f1');
  });

  it('16. alias conflict時はFoodAliasConflictErrorをthrowし、誤ったFoodへ解決しない', async () => {
    mockFoodsResponse([
      { ...杏, id: 'f1', canonicalName: '食材A', aliases: ['同名'] },
      { ...杏, id: 'f2', canonicalName: '食材B', aliases: ['同名'] },
    ]);
    await expect(resolveFoodByName('同名', 'token')).rejects.toBeInstanceOf(FoodAliasConflictError);
  });
});

// fetchRelatedProcesses()自体（BFS＋Relation集約の実ロジック）を検証する。
// 本番バグ（複数Inputのうち起点Food以外が欠落する）はFoodEncyclopediaDetailScreenのテストで
// fetchRelatedProcessesをmockしていたため検出できなかった。ここではfetchRelatedProcessesはmockせず、
// 下位のfetch（GET /foods, /processes, /processed-products, /knowledge-relations）だけをmockする
function food(overrides: Partial<FoodEntity>): FoodEntity {
  return { id: '', canonicalName: '', aliases: [], usableParts: [], description: '', createdAt: '', updatedAt: '', createdBy: '', ...overrides };
}
function process(overrides: Partial<ProcessEntity>): ProcessEntity {
  return { id: '', name: '', description: '', steps: [], createdAt: '', updatedAt: '', createdBy: '', ...overrides };
}
function product(overrides: Partial<ProcessedProductEntity>): ProcessedProductEntity {
  return { id: '', name: '', description: '', createdAt: '', updatedAt: '', createdBy: '', ...overrides };
}
function relation(overrides: Partial<KnowledgeRelation>): KnowledgeRelation {
  return { id: '', sourceType: '', sourceId: '', targetType: '', targetId: '', relationType: '', createdAt: '', createdBy: '', ...overrides };
}

function mockKnowledgeGraph(data: {
  foods: FoodEntity[]; processes: ProcessEntity[]; products: ProcessedProductEntity[]; relations: KnowledgeRelation[];
}) {
  global.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    const jsonRes = (body: unknown) => ({ status: 200, json: async () => body }) as Response;
    if (url.pathname.endsWith('/foods') && !url.search) return jsonRes({ status: 'success', items: data.foods });
    if (url.pathname.endsWith('/processes')) return jsonRes({ status: 'success', items: data.processes });
    if (url.pathname.endsWith('/processed-products')) return jsonRes({ status: 'success', items: data.products });
    if (url.pathname.endsWith('/knowledge-relations')) {
      const sourceType = url.searchParams.get('sourceType');
      const sourceId = url.searchParams.get('sourceId');
      const targetType = url.searchParams.get('targetType');
      const targetId = url.searchParams.get('targetId');
      const items = data.relations.filter((r) =>
        (!!sourceType && !!sourceId && r.sourceType === sourceType && r.sourceId === sourceId) ||
        (!!targetType && !!targetId && r.targetType === targetType && r.targetId === targetId),
      );
      return jsonRes({ status: 'success', items });
    }
    throw new Error(`unexpected url in test: ${url.toString()}`);
  }) as unknown as typeof fetch;
}

describe('fetchRelatedProcesses', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('17. 複数Food Input Process: トマト起点でトマト・玉ねぎ両方がusesに載る', async () => {
    const tomato = food({ id: 'f-tomato', canonicalName: 'トマト' });
    const onion = food({ id: 'f-onion', canonicalName: '玉ねぎ' });
    const ketchupProcess = process({ id: 'p-ketchup', name: 'トマトケチャップを作る' });
    const ketchupProduct = product({ id: 'pp-ketchup', name: 'トマトケチャップ' });
    const relations = [
      relation({ sourceType: 'process', sourceId: 'p-ketchup', targetType: 'food', targetId: 'f-tomato', relationType: 'uses' }),
      relation({ sourceType: 'process', sourceId: 'p-ketchup', targetType: 'food', targetId: 'f-onion', relationType: 'uses' }),
      relation({ sourceType: 'process', sourceId: 'p-ketchup', targetType: 'processed_product', targetId: 'pp-ketchup', relationType: 'produces' }),
    ];
    mockKnowledgeGraph({ foods: [tomato, onion], processes: [ketchupProcess], products: [ketchupProduct], relations });

    const groups = await fetchRelatedProcesses('f-tomato', 'token');
    expect(groups).toHaveLength(1);
    expect(groups[0].process.name).toBe('トマトケチャップを作る');
    expect(groups[0].uses.map((u) => u.name).sort()).toEqual(['トマト', '玉ねぎ']);
    expect(groups[0].produces.map((p) => p.name)).toEqual(['トマトケチャップ']);
  });

  it('18. 同じProcessを玉ねぎ起点で見ても、uses一覧は起点Foodに依存せず同一', async () => {
    const tomato = food({ id: 'f-tomato', canonicalName: 'トマト' });
    const onion = food({ id: 'f-onion', canonicalName: '玉ねぎ' });
    const ketchupProcess = process({ id: 'p-ketchup', name: 'トマトケチャップを作る' });
    const ketchupProduct = product({ id: 'pp-ketchup', name: 'トマトケチャップ' });
    const relations = [
      relation({ sourceType: 'process', sourceId: 'p-ketchup', targetType: 'food', targetId: 'f-tomato', relationType: 'uses' }),
      relation({ sourceType: 'process', sourceId: 'p-ketchup', targetType: 'food', targetId: 'f-onion', relationType: 'uses' }),
      relation({ sourceType: 'process', sourceId: 'p-ketchup', targetType: 'processed_product', targetId: 'pp-ketchup', relationType: 'produces' }),
    ];
    mockKnowledgeGraph({ foods: [tomato, onion], processes: [ketchupProcess], products: [ketchupProduct], relations });

    const groups = await fetchRelatedProcesses('f-onion', 'token');
    expect(groups).toHaveLength(1);
    expect(groups[0].uses.map((u) => u.name).sort()).toEqual(['トマト', '玉ねぎ']);
  });

  it('19. 単一Food Input: 従来通りInput1件のみが載る（回帰）', async () => {
    const anzu = food({ id: 'f-anzu', canonicalName: '杏' });
    const semidryProcess = process({ id: 'p-semidry', name: '杏セミドライを作る' });
    const semidryProduct = product({ id: 'pp-semidry', name: 'セミドライ杏' });
    const syrupProduct = product({ id: 'pp-syrup', name: '杏の濃縮シロップ' });
    const relations = [
      relation({ sourceType: 'process', sourceId: 'p-semidry', targetType: 'food', targetId: 'f-anzu', relationType: 'uses' }),
      relation({ sourceType: 'process', sourceId: 'p-semidry', targetType: 'processed_product', targetId: 'pp-semidry', relationType: 'produces' }),
      relation({ sourceType: 'process', sourceId: 'p-semidry', targetType: 'processed_product', targetId: 'pp-syrup', relationType: 'produces' }),
    ];
    mockKnowledgeGraph({ foods: [anzu], processes: [semidryProcess], products: [semidryProduct, syrupProduct], relations });

    const groups = await fetchRelatedProcesses('f-anzu', 'token');
    expect(groups).toHaveLength(1);
    expect(groups[0].uses).toEqual([{ id: 'f-anzu', name: '杏' }]);
    expect(groups[0].produces.map((p) => p.name).sort()).toEqual(['セミドライ杏', '杏の濃縮シロップ']);
  });

  it('20. Product Input descendant: ナマコ2段chainのuses/producesが維持される（回帰）', async () => {
    const namako = food({ id: 'f-namako', canonicalName: 'ナマコ' });
    const yuderuProcess = process({ id: 'p-yuderu', name: 'ナマコを茹でる' });
    const shioProcess = process({ id: 'p-shio', name: 'ナマコ塩を作る' });
    const yudeta = product({ id: 'pp-yudeta', name: '茹でたナマコ' });
    const yudejiru = product({ id: 'pp-yudejiru', name: 'ナマコの茹で汁' });
    const shio = product({ id: 'pp-shio', name: 'ナマコ塩' });
    const relations = [
      relation({ sourceType: 'process', sourceId: 'p-yuderu', targetType: 'food', targetId: 'f-namako', relationType: 'uses' }),
      relation({ sourceType: 'process', sourceId: 'p-yuderu', targetType: 'processed_product', targetId: 'pp-yudeta', relationType: 'produces' }),
      relation({ sourceType: 'process', sourceId: 'p-yuderu', targetType: 'processed_product', targetId: 'pp-yudejiru', relationType: 'produces' }),
      relation({ sourceType: 'process', sourceId: 'p-shio', targetType: 'processed_product', targetId: 'pp-yudejiru', relationType: 'uses' }),
      relation({ sourceType: 'process', sourceId: 'p-shio', targetType: 'processed_product', targetId: 'pp-shio', relationType: 'produces' }),
    ];
    mockKnowledgeGraph({ foods: [namako], processes: [yuderuProcess, shioProcess], products: [yudeta, yudejiru, shio], relations });

    const groups = await fetchRelatedProcesses('f-namako', 'token');
    expect(groups).toHaveLength(2);
    const root = groups.find((g) => g.process.name === 'ナマコを茹でる')!;
    const descendant = groups.find((g) => g.process.name === 'ナマコ塩を作る')!;
    expect(root.uses).toEqual([{ id: 'f-namako', name: 'ナマコ' }]);
    expect(root.produces.map((p) => p.name).sort()).toEqual(['ナマコの茹で汁', '茹でたナマコ']);
    expect(descendant.uses).toEqual([{ id: 'pp-yudejiru', name: 'ナマコの茹で汁' }]);
    expect(descendant.produces.map((p) => p.name)).toEqual(['ナマコ塩']);
  });

  it('21. cycle安全性: Process間で循環するRelationがあってもハングせず、重複追加もされない', async () => {
    const x = food({ id: 'f-x', canonicalName: 'X' });
    const p1 = product({ id: 'pp-1', name: 'P1' });
    const p2 = product({ id: 'pp-2', name: 'P2' });
    const procA = process({ id: 'p-a', name: 'A' });
    const procB = process({ id: 'p-b', name: 'B' });
    const procC = process({ id: 'p-c', name: 'C' });
    // A: X -> P1 / B: P1 -> P2 / C: P2 -> P1（P1に戻る循環）
    const relations = [
      relation({ sourceType: 'process', sourceId: 'p-a', targetType: 'food', targetId: 'f-x', relationType: 'uses' }),
      relation({ sourceType: 'process', sourceId: 'p-a', targetType: 'processed_product', targetId: 'pp-1', relationType: 'produces' }),
      relation({ sourceType: 'process', sourceId: 'p-b', targetType: 'processed_product', targetId: 'pp-1', relationType: 'uses' }),
      relation({ sourceType: 'process', sourceId: 'p-b', targetType: 'processed_product', targetId: 'pp-2', relationType: 'produces' }),
      relation({ sourceType: 'process', sourceId: 'p-c', targetType: 'processed_product', targetId: 'pp-2', relationType: 'uses' }),
      relation({ sourceType: 'process', sourceId: 'p-c', targetType: 'processed_product', targetId: 'pp-1', relationType: 'produces' }),
    ];
    mockKnowledgeGraph({ foods: [x], processes: [procA, procB, procC], products: [p1, p2], relations });

    const groups = await fetchRelatedProcesses('f-x', 'token');
    expect(groups).toHaveLength(3); // A/B/Cそれぞれ1回のみ（循環で重複追加されない）
    const b = groups.find((g) => g.process.name === 'B')!;
    expect(b.uses).toEqual([{ id: 'pp-1', name: 'P1' }]); // 循環で複数回積まれていない
  });

  it('22. hop-limit: 深いchainでもhop上限（10）で打ち切られ、ハングしない', async () => {
    const x = food({ id: 'f-x', canonicalName: 'X' });
    const chainLength = 12;
    const processes: ProcessEntity[] = [];
    const products: ProcessedProductEntity[] = [];
    const relations: KnowledgeRelation[] = [];
    for (let i = 1; i <= chainLength; i++) {
      const procId = `p-${i}`;
      const prodId = `pp-${i}`;
      processes.push(process({ id: procId, name: `Process${i}` }));
      products.push(product({ id: prodId, name: `Product${i}` }));
      const inputType = i === 1 ? 'food' : 'processed_product';
      const inputId = i === 1 ? 'f-x' : `pp-${i - 1}`;
      relations.push(relation({ sourceType: 'process', sourceId: procId, targetType: inputType, targetId: inputId, relationType: 'uses' }));
      relations.push(relation({ sourceType: 'process', sourceId: procId, targetType: 'processed_product', targetId: prodId, relationType: 'produces' }));
    }
    mockKnowledgeGraph({ foods: [x], processes, products, relations });

    const groups = await fetchRelatedProcesses('f-x', 'token');
    const names = groups.map((g) => g.process.name);
    expect(names).toContain('Process1');
    expect(names).not.toContain('Process11');
    expect(names).not.toContain('Process12');
    expect(groups.length).toBeLessThan(chainLength);
  });
});
