import { FOODS_URL, PROCESSES_URL, PROCESSED_PRODUCTS_URL, KNOWLEDGE_RELATIONS_URL, KNOWLEDGE_PROCESSES_URL } from '../config';
import { TokenExpiredError } from './icarusApi';
import { NetworkUnknownError } from './workApi';
import type {
  FoodEntity, ProcessEntity, ProcessedProductEntity, KnowledgeRelation, FoodFormInput,
  CompositeProcessRequest, CompositeProcessResponse,
} from '../types/knowledge';

interface ErrorBody {
  status: 'error';
  message: string;
  code?: string;
}

// Worker側のerror code（例: FOOD_DUPLICATE）を呼び出し側で判定できるよう、messageに加えてcodeも保持する
export class KnowledgeApiError extends Error {
  code?: string;
  constructor(message: string, code?: string) {
    super(message);
    this.name = 'KnowledgeApiError';
    this.code = code;
  }
}

async function request<T>(url: string, idToken: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      ...init,
      headers: { ...(init?.headers ?? {}), Authorization: `Bearer ${idToken}` },
    });
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
  if ((json as ErrorBody).status === 'error') {
    const err = json as ErrorBody;
    throw new KnowledgeApiError(err.message || '取得に失敗しました', err.code);
  }
  return json as T;
}

// alias exact matchが複数Foodに衝突した場合に投げる。誤ったFoodへ接続するより、
// 何も表示しない方が安全なため、呼び出し側はこれをcatchしてnull相当（非表示）として扱う
export class FoodAliasConflictError extends Error {
  constructor(name: string) {
    super(`"${name}"に一致するaliasを持つFoodが複数存在します`);
    this.name = 'FoodAliasConflictError';
  }
}

// canonicalName、または人が確認済みのaliasesの完全一致でFood Entityを1件解決する。
// GET /foods?q=はcanonical_name/aliasesへのLIKE検索（曖昧検索）のため、
// ここでは返ってきた候補に対し必ずexact matchを再検証する（検索結果をそのままIdentityとして採用しない）。
// canonical一致をalias一致より優先する。fuzzy match・かな正規化・AI推論は行わない（trimのみ）。
// 存在しない食材（Food Entity未導入）はnullを返す（食材図鑑の他の食材の表示には一切影響しない設計）
export async function resolveFoodByName(name: string, idToken: string): Promise<FoodEntity | null> {
  const trimmed = name.trim();
  const json = await request<{ status: 'success'; items: FoodEntity[] }>(
    `${FOODS_URL}?q=${encodeURIComponent(trimmed)}`, idToken,
  );

  const canonicalMatch = json.items.find((f) => f.canonicalName === trimmed);
  if (canonicalMatch) return canonicalMatch;

  const aliasMatches = json.items.filter((f) => f.aliases.includes(trimmed));
  if (aliasMatches.length > 1) throw new FoodAliasConflictError(trimmed);
  return aliasMatches[0] ?? null;
}

// Food selectorが正式Food Entity（GET /foods）のみを候補にするために使う。
// Field Log由来174食材（/field/foods）とは別物であり、混ぜない
export async function fetchAllFoods(idToken: string): Promise<FoodEntity[]> {
  const json = await request<{ status: 'success'; items: FoodEntity[] }>(FOODS_URL, idToken);
  return json.items;
}

async function fetchAllProcesses(idToken: string): Promise<ProcessEntity[]> {
  const json = await request<{ status: 'success'; items: ProcessEntity[] }>(PROCESSES_URL, idToken);
  return json.items;
}

export async function fetchAllProcessedProducts(idToken: string): Promise<ProcessedProductEntity[]> {
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
  uses: { id: string; name: string }[];
  produces: ProcessedProductEntity[];
}

// Food起点でuses/producesのRelationを辿り、関連するProcess/ProcessedProductの連鎖を集める。
// 現状の規模（数件のRelation）を前提にした単純なBFS。ホップ数に上限を設け、無限ループを防ぐ
export async function fetchRelatedProcesses(foodId: string, idToken: string): Promise<RelatedProcessGroup[]> {
  const [allFoods, allProcesses, allProducts] = await Promise.all([
    fetchAllFoods(idToken),
    fetchAllProcesses(idToken),
    fetchAllProcessedProducts(idToken),
  ]);
  const foodById = new Map(allFoods.map((f) => [f.id, f]));
  const processById = new Map(allProcesses.map((p) => [p.id, p]));
  const productById = new Map(allProducts.map((p) => [p.id, p]));

  const nameOf = (type: 'food' | 'processed_product', id: string): string | null => {
    if (type === 'food') return foodById.get(id)?.canonicalName ?? null;
    return productById.get(id)?.name ?? null;
  };

  const visitedProcessIds = new Set<string>();
  const usesMap = new Map<string, { id: string; name: string }[]>(); // processId -> 全input一覧（正本）
  const producesMap = new Map<string, Set<string>>(); // processId -> productIds

  // Processが新規visited化された時点で、そのProcess自身が持つ全uses/produces Relationを取得し、
  // usesMap/producesMapの正本とする。「BFSでどのInputから到達したか」は使わない
  // （起点Foodに関わらず同じProcessは常に同じuses一覧になる）
  const loadProcessRelations = async (processId: string): Promise<{ type: 'processed_product'; id: string }[]> => {
    const relations = await fetchRelationsBySource('process', processId, idToken);
    const uses: { id: string; name: string }[] = [];
    const productIds = new Set<string>();
    const nextNodes: { type: 'processed_product'; id: string }[] = [];
    for (const r of relations) {
      if (r.relationType === 'uses' && (r.targetType === 'food' || r.targetType === 'processed_product')) {
        const name = nameOf(r.targetType, r.targetId);
        if (name) uses.push({ id: r.targetId, name });
      } else if (r.relationType === 'produces' && r.targetType === 'processed_product') {
        productIds.add(r.targetId);
        nextNodes.push({ type: 'processed_product', id: r.targetId });
      }
    }
    usesMap.set(processId, uses);
    producesMap.set(processId, productIds);
    return nextNodes;
  };

  // Food/Product → それをusesするProcessを見つける発見専用のBFS。
  // ここで見つかったProcessの内容（uses/produces）はloadProcessRelationsが別途取得する
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
        nextFrontier.push(...(await loadProcessRelations(r.sourceId)));
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
    groups.push({ process, uses: usesMap.get(processId) ?? [], produces });
  }
  return groups;
}

// Composite API（POST /knowledge/processes）。Process + Input(uses) + Output(produces)を1回で保存する。
// 既存のfetchAllFoods等の個別GET APIは変更しない。Admin限定（403はrequest()内でErrorとして投げられる）
export async function createProcessKnowledge(
  input: CompositeProcessRequest,
  idToken: string,
): Promise<CompositeProcessResponse> {
  return request<CompositeProcessResponse>(KNOWLEDGE_PROCESSES_URL, idToken, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
}

// Food Editor用。同じcanonicalNameのFoodが既に存在する場合にWorkerが返す409 FOOD_DUPLICATEを、
// 生のAPIエラーではなく人が理解できるメッセージへ変換して投げる
export class FoodDuplicateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FoodDuplicateError';
  }
}

export class FoodNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FoodNotFoundError';
  }
}

function throwForFoodError(e: unknown): never {
  if (e instanceof KnowledgeApiError && e.code === 'FOOD_DUPLICATE') {
    throw new FoodDuplicateError('同じ正式名称のFoodが既に存在します');
  }
  if (e instanceof KnowledgeApiError && e.code === 'FOOD_NOT_FOUND') {
    throw new FoodNotFoundError(e.message);
  }
  throw e;
}

// Food Editor用。componentから直接fetchせず、必ずこの関数経由でFood Entityを新規作成する
export async function createFood(input: FoodFormInput, idToken: string): Promise<FoodEntity> {
  try {
    const json = await request<{ status: 'success'; item: FoodEntity }>(FOODS_URL, idToken, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    return json.item;
  } catch (e) {
    throwForFoodError(e);
  }
}

// Food Editor用。PATCHは常に4フィールド全てを送る（部分更新の分岐を呼び出し側へ持ち込まない）
export async function updateFood(id: string, input: FoodFormInput, idToken: string): Promise<FoodEntity> {
  try {
    const json = await request<{ status: 'success'; item: FoodEntity }>(`${FOODS_URL}/${encodeURIComponent(id)}`, idToken, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    return json.item;
  } catch (e) {
    throwForFoodError(e);
  }
}
