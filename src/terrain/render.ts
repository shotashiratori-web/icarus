import { accessClassRaw, isCandidateRaw, type AccessClass, type CompiledConditions } from './engine';
import type { TerrainGrid } from './types';

// 条件に合う格子を色で塗った RGBA を作る（canvas → Leaflet の画像オーバーレイ）。DOM に依存しない純粋関数

export interface OverlayLayers {
  candidates: Record<AccessClass, boolean>;
  ridge: boolean;
  sun: boolean;
  // 探索範囲（Stage 2）。explored が与えられた時、範囲内の候補を「探索済み」の色で塗る（表示しない設定なら塗らない）
  exploredCandidates?: boolean;
}

export const EXPLORED_COLOR: [number, number, number] = [145, 167, 255]; // 薄い青: 探索済みの候補

export const CANDIDATE_COLORS: Record<AccessClass, [number, number, number]> = {
  A: [250, 176, 5], // 黄: 車道・林道から近い
  B: [232, 89, 12], // 橙: 徒歩道から近い
  C: [194, 37, 92], // 赤紫: 道から離れている
};
const RIDGE: [number, number, number] = [123, 44, 191];

export function renderOverlay(grid: TerrainGrid, cc: CompiledConditions, layers: OverlayLayers, sunScale: number, out?: Uint8ClampedArray, explored?: Uint8Array | null): Uint8ClampedArray {
  const n = grid.width * grid.height;
  const o = out ?? new Uint8ClampedArray(n * 4);
  o.fill(0);
  const t = grid.terrain;
  for (let i = 0; i < n; i++) {
    const j = i * 4;
    if (t[j + 3] === 0) continue;
    if (layers.sun) {
      const v = Math.min(1, Math.max(0, t[j + 1] / sunScale - 0.5));
      o[j] = 28 + v * 218; o[j + 1] = 63 + v * 152; o[j + 2] = 149 - v * 82; o[j + 3] = 110;
    }
    if (layers.ridge && t[j + 2] === 0) {
      o[j] = RIDGE[0]; o[j + 1] = RIDGE[1]; o[j + 2] = RIDGE[2]; o[j + 3] = 200;
    }
    if (isCandidateRaw(grid, i, cc)) {
      if (explored && explored[i]) {
        if (layers.exploredCandidates !== false) {
          o[j] = EXPLORED_COLOR[0]; o[j + 1] = EXPLORED_COLOR[1]; o[j + 2] = EXPLORED_COLOR[2]; o[j + 3] = 200;
        }
        continue;
      }
      const k = accessClassRaw(grid, i, cc);
      if (layers.candidates[k]) {
        const c = CANDIDATE_COLORS[k];
        o[j] = c[0]; o[j + 1] = c[1]; o[j + 2] = c[2]; o[j + 3] = 215;
      }
    }
  }
  return o;
}
