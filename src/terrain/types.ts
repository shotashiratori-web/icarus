// 地形探索（Exploration Mode Stage 1）の型。エリアパッケージは icarus-api の scripts/terrain/build_area.py が作る。
// 設計: icarus/docs/architecture/icarus_mushroom_sansai_exploration_mode_final_design.md（§3・§11）

export interface TerrainBounds {
  south: number;
  north: number;
  west: number;
  east: number;
}

export interface TerrainManifest {
  areaId: string;
  name: string;
  version: string;
  createdAt: string;
  bounds: TerrainBounds;
  grid: {
    width: number;
    height: number;
    pxM: number; // 1 格子の地上距離（m）
    z: number;
    tx0: number;
    ty0: number;
    factor: number; // DEM 何画素を 1 格子にまとめたか
    cropX: number; // 解析格子のうち、利用範囲の左上
    cropY: number;
  };
  landKm2: number;
  params: {
    date: string;
    slope_scale: number;
    rel_scale: number;
    ridge_dist_max_px: number;
    access_dist_max_px: number;
    [k: string]: unknown;
  };
  relPercentiles: Record<'50' | '60' | '70' | '80' | '90', number>;
  // DEM 由来の地形（terrain2.png）は 2026-09-29 の版から。湿潤度の分位点（利用範囲の陸地）
  twiPercentiles?: Record<'33' | '50' | '67' | '90', number>;
  sources: { name: string; url: string }[];
  // 等高線（contours.json）は 2026-09-29 の版から。古い版の manifest には無い
  files: Record<BaseFileName, { bytes: number; sha256: string }> & Partial<Record<OptionalFileName, { bytes: number; sha256: string }>>;
}

export type BaseFileName = 'terrain.png' | 'access.png' | 'roads.json' | 'hillshade.jpg';
export type OptionalFileName = 'contours.json' | 'forest.png' | 'forest.json' | 'terrain2.png';
export type TerrainFileName = BaseFileName | OptionalFileName;

export interface TerrainAreaSummary {
  areaId: string;
  name: string;
  version: string;
  bounds: TerrainBounds;
  totalBytes: number;
}

// 表示用の道。c: road=一般道 / narrow=幅3m未満 / forest=林道・作業道 / trail=登山道・徒歩道
export type RoadClass = 'road' | 'narrow' | 'forest' | 'trail';
export interface RoadLine {
  c: RoadClass;
  p: [number, number][];
  n?: string; // 名前
  f?: string; // 舗装（OSM surface）
  s?: string; // 出典
}

// 復号済みの格子（PNG の RGBA をそのまま持つ。値の意味は manifest.params と build_area.py を参照）
export interface TerrainGrid {
  width: number;
  height: number;
  terrain: Uint8ClampedArray; // R=傾斜 G=日射 B=尾根距離 A=陸
  access: Uint8ClampedArray; // R=車道・林道までの距離 G=徒歩道までの距離
}
