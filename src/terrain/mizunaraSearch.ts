import type { ForestLayers } from './forest';

// 「ミズナラを探す」（icarus_forest_stand_age_view_v1_design.md §2）。ミズナラについて確度の違う根拠を、種類を残したまま一度に見る:
//   森林計画 1〜3 位（面）・ミズナラ系植生群落（斜線）・現地確認したミズナラ（環境スポット）・Field Log ミズナラ（小さな点）
// 何も消さない。押した直後は 1〜3 位すべて ON・順位で見る（1 位を強調しない。初舞茸・確認 3 本はすべて 2 位）。
// 樹種不明の天然林は OFF（「無い」ではなく「判別できない」所。根拠のある所と混ぜない）

export const MIZUNARA = 'ミズナラ';

export function mizunaraSearchLayers(l: ForestLayers, communities: string[]): ForestLayers {
  return { ...l, species: MIZUNARA, mz1: true, mz2: true, mz3: true, vegMizunara: [...communities], broadleafUnknown: false };
}

// Field Log のミズナラ: 食材名に「ミズナラ」を含む（無効化した記録は地図のデータに来ない）
export const isMizunaraLog = (e: { foodName?: string | null; lat: number; lng: number }) =>
  !!e.foodName && e.foodName.includes(MIZUNARA) && Number.isFinite(e.lat) && Number.isFinite(e.lng);
