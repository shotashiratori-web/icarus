import type { ExplorationConditions } from './engine';

// Species Preset（§11-2）: Exploration Mode の条件の組み合わせに名前を付けたもの。
// Terrain Engine は対象を知らない。対象ごとの条件はここに足す（ヤマドリタケ・山菜・ミズナラ探索など）。
// 「この条件の場所に出る」という意味ではない。探す場所を絞るための地形の手がかり

export interface SpeciesPreset {
  id: string;
  label: string;
  description: string;
  conditions: ExplorationConditions;
}

export const SPECIES_PRESETS: SpeciesPreset[] = [
  {
    id: 'maitake',
    label: '舞茸探索',
    description: '日当たりの良い急勾配の尾根（傾斜 25° 以上・日射 上位 30%・尾根線から約 60m 以内）',
    conditions: { slopeMinDeg: 25, sunTopPct: 30, ridgeMaxM: 63 },
  },
];

export const CUSTOM_PRESET_ID = 'custom';

export function presetById(id: string): SpeciesPreset | undefined {
  return SPECIES_PRESETS.find((p) => p.id === id);
}

// 今の条件がどのプリセットと同じか（違えば「条件を自分で決める」）
export function matchPreset(c: ExplorationConditions): string {
  const hit = SPECIES_PRESETS.find((p) =>
    p.conditions.slopeMinDeg === c.slopeMinDeg && p.conditions.sunTopPct === c.sunTopPct && p.conditions.ridgeMaxM === c.ridgeMaxM);
  return hit ? hit.id : CUSTOM_PRESET_ID;
}
