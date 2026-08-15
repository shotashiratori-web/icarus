import { FOODS_URL, PROCESSES_URL, PROCESSED_PRODUCTS_URL, KNOWLEDGE_RELATIONS_URL } from '../config';
import { TokenExpiredError } from './icarusApi';
import { NetworkUnknownError } from './workApi';
import type { FoodEntity, ProcessEntity, ProcessedProductEntity, KnowledgeRelation } from '../types/knowledge';

interface ErrorBody {
  status: 'error';
  message: string;
  code?: string;
}

async function request<T>(url: string, idToken: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { headers: { Authorization: `Bearer ${idToken}` } });
  } catch {
    throw new NetworkUnknownError();
  }
  if (res.status === 401) {
    throw new TokenExpiredError('ログインセッションが切れました。再度ログインしてください。');
  }
  let json: T | ErrorBody;
  try {
    json = await res.json();
  } catch {
    throw new Error(`サーバーエラー (HTTP ${res.status})`);
  }
  if ((json as ErrorBody).status === 'error') throw new Error((json as ErrorBody).message || '取得に失敗しました');
  return json as T;
}

// canonicalNameの完全一致でFood Entityを探す。存在しない食材（Food Entity未導入）はnullを返す
// （食材図鑑の他の食材の表示には一切影響しない設計）
export async function fetchFoodByCanonicalName(name: string, idToken: string): Promise<FoodEntity | null> {
  const json = await request<{ status: 'success'; items: FoodEntity[] }>(
    `${FOODS_URL}?q=${encodeURIComponent(name)}`, idToken,
  );
  return json.items.find((f) => f.canonicalName === name) ?? null;
}

async function fetchAllProcesses(idToken: string): Promise<ProcessEntity[]> {
  const json = await request<{ status: 'success'; items: ProcessEntity[] }>(PROCESSES_URL, idToken);
  return json.items;
}

async function fetchAllProcessedProducts(idToken: string): Promise<ProcessedProductEntity[]> {
  const json = await request<{ status: 'success'; items: ProcessedProductEntity[] }>(PROCESSED_PRODUCTS_URL, idToken);
  return json.items;
}

async function fetchRelationsByTarget(targetType: string, targetId: string, idToken: string): Promise<KnowledgeRelation[]> {
  const json = await request<{ status: 'success'; items: KnowledgeRelation[] }>(
    `${KNOWLEDGE_RELATIONS_URL}?targetType=${encodeURIComponent(targetType)}&targetId=${encodeURIComponent(targetId)}`, idToken,
  );
  return json.items;
}

async function fetchRelationsBySource(sourceType: string, sourceId: string, idToken: string): Promise<KnowledgeRelation[]> {
  const json = await request<{ status: 'success'; items: KnowledgeRelation[] }>(
    `${KNOWLEDGE_RELATIONS_URL}?sourceType=${encodeURIComponent(sourceType)}&sourceId=${encodeURIComponent(sourceId)}`, idToken,
  );
  return json.items;
}

export interface RelatedProcessGroup {
  process: ProcessEntity;
  produces: ProcessedProductEntity[];
}

// Food起点でuses/producesのRelationを辿り、関連するProcess/ProcessedProductの連鎖を集める。
// 現状の規模（数件のRelation）を前提にした単純なBFS。ホップ数に上限を設け、無限ループを防ぐ
export async function fetchRelatedProcesses(foodId: string, idToken: string): Promise<RelatedProcessGroup[]> {
  const [allProcesses, allProducts] = await Promise.all([
    fetchAllProcesses(idToken),
    fetchAllProcessedProducts(idToken),
  ]);
  const processById = new Map(allProcesses.map((p) => [p.id, p]));
  const productById = new Map(allProducts.map((p) => [p.id, p]));

  const visitedProcessIds = new Set<string>();
  const producesMap = new Map<string, Set<string>>(); // processId -> productIds

  let frontier: { type: 'food' | 'processed_product'; id: string }[] = [{ type: 'food', id: foodId }];
  let hop = 0;
  while (frontier.length > 0 && hop < 10) {
    hop += 1;
    const nextFrontier: { type: 'food' | 'processed_product'; id: string }[] = [];
    for (const node of frontier) {
      const relations = await fetchRelationsByTarget(node.type, node.id, idToken);
      for (const r of relations) {
        if (r.relationType !== 'uses' || r.sourceType !== 'process') continue;
        if (visitedProcessIds.has(r.sourceId)) continue;
        visitedProcessIds.add(r.sourceId);

        const produced = await fetchRelationsBySource('process', r.sourceId, idToken);
        const productIds = new Set<string>();
        for (const pr of produced) {
          if (pr.relationType === 'produces' && pr.targetType === 'processed_product') {
            productIds.add(pr.targetId);
            nextFrontier.push({ type: 'processed_product', id: pr.targetId });
          }
        }
        producesMap.set(r.sourceId, productIds);
      }
    }
    frontier = nextFrontier;
  }

  const groups: RelatedProcessGroup[] = [];
  for (const processId of visitedProcessIds) {
    const process = processById.get(processId);
    if (!process) continue;
    const productIds = producesMap.get(processId) ?? new Set<string>();
    const produces = Array.from(productIds)
      .map((id) => productById.get(id))
      .filter((p): p is ProcessedProductEntity => !!p);
    groups.push({ process, produces });
  }
  return groups;
}
