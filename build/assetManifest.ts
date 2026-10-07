// asset-manifest.json（Service Worker がアプリ本体として端末に保存する一覧）に入れるファイル。
// PC だけで使う 3D（Terrain3DView・MapLibre とその worker）は外す（iPhone に保存させない。icarus_3d_terrain_view_technical_audit.md §8）
export const PC_ONLY_ASSET = /^assets\/(Terrain3DView|maplibre-gl)[-.]/;

export function assetManifestFiles(bundleFiles: string[]): string[] {
  return bundleFiles.filter((f) => f.startsWith('assets/') && !PC_ONLY_ASSET.test(f)).sort();
}
