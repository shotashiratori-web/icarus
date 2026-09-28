import { WORKER_URL } from '../config';
import { TokenExpiredError } from './icarusApi';
import type { TerrainAreaSummary, TerrainFileName } from '../terrain/types';

// 地形探索（Exploration Mode Stage 1）: エリアパッケージの読み取り（icarus-api /terrain/*、active staff）

export const TERRAIN_AREAS_URL = `${WORKER_URL}/terrain/areas`;

export class TerrainOfflineError extends Error {
  constructor() {
    super('通信できないため地形データを取得できません。オフライン保存したエリアだけ表示できます。');
    this.name = 'TerrainOfflineError';
  }
}

async function get(url: string, idToken: string): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(url, { headers: { Authorization: `Bearer ${idToken}` } });
  } catch {
    throw new TerrainOfflineError();
  }
  if (res.status === 401) throw new TokenExpiredError('ログインの有効期限が切れています');
  if (!res.ok) throw new Error(`地形データを取得できませんでした (HTTP ${res.status})`);
  return res;
}

export async function fetchTerrainAreas(idToken: string): Promise<TerrainAreaSummary[]> {
  const body = (await (await get(TERRAIN_AREAS_URL, idToken)).json()) as { items?: TerrainAreaSummary[] };
  return Array.isArray(body.items) ? body.items : [];
}

export function terrainFileUrl(areaId: string, version: string, file: TerrainFileName | 'manifest.json'): string {
  return `${TERRAIN_AREAS_URL}/${encodeURIComponent(areaId)}/${encodeURIComponent(version)}/${file}`;
}

export async function fetchTerrainFile(areaId: string, version: string, file: TerrainFileName | 'manifest.json', idToken: string): Promise<Blob> {
  return (await get(terrainFileUrl(areaId, version, file), idToken)).blob();
}
