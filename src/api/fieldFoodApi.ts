import { FIELD_FOODS_URL, FIELD_FOOD_DETAIL_URL } from '../config';
import type {
  FieldFoodListItem,
  FieldFoodListSuccess,
  FieldFoodDetailSuccess,
  FieldFoodError,
} from '../types/fieldFood';
import { TokenExpiredError } from './icarusApi';
import { NetworkUnknownError } from './workApi';

export class FieldFoodNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FieldFoodNotFoundError';
  }
}

function throwForError(json: FieldFoodError): never {
  if (json.code === 'FOOD_NOT_FOUND') throw new FieldFoodNotFoundError(json.message);
  throw new Error(json.message || '取得に失敗しました');
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
  let json: T | FieldFoodError;
  try {
    json = await res.json();
  } catch {
    throw new Error(`サーバーエラー (HTTP ${res.status})`);
  }
  if ((json as FieldFoodError).status === 'error') throwForError(json as FieldFoodError);
  return json as T;
}

export interface FieldFoodListFilter {
  search?: string;
  largeCategory?: string;
  subCategory?: string;
  hasPhoto?: boolean;
  hasGps?: boolean;
  observedPart?: string;
  sort?: 'lastObservedDate' | 'name';
}

export async function fetchFieldFoods(filter: FieldFoodListFilter, idToken: string): Promise<{ items: FieldFoodListItem[]; totalCount: number }> {
  const params = new URLSearchParams();
  if (filter.search) params.set('search', filter.search);
  if (filter.largeCategory) params.set('largeCategory', filter.largeCategory);
  if (filter.subCategory) params.set('subCategory', filter.subCategory);
  if (filter.hasPhoto !== undefined) params.set('hasPhoto', String(filter.hasPhoto));
  if (filter.hasGps !== undefined) params.set('hasGps', String(filter.hasGps));
  if (filter.observedPart) params.set('observedPart', filter.observedPart);
  if (filter.sort) params.set('sort', filter.sort);
  const url = params.toString() ? `${FIELD_FOODS_URL}?${params.toString()}` : FIELD_FOODS_URL;
  const json = await request<FieldFoodListSuccess>(url, idToken);
  return { items: json.items, totalCount: json.totalCount };
}

export async function fetchFieldFoodDetail(
  foodName: string,
  idToken: string,
  opts?: { limit?: number; offset?: number },
): Promise<FieldFoodDetailSuccess> {
  const params = new URLSearchParams();
  params.set('name', foodName);
  if (opts?.limit !== undefined) params.set('limit', String(opts.limit));
  if (opts?.offset !== undefined) params.set('offset', String(opts.offset));
  return request<FieldFoodDetailSuccess>(`${FIELD_FOOD_DETAIL_URL}?${params.toString()}`, idToken);
}
