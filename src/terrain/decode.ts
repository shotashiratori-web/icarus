import type { AreaPackage } from './areaStore';
import type { RoadLine, TerrainGrid } from './types';

// パッケージの PNG を格子の値へ戻す。色空間の変換・アルファの乗算をさせない（値がずれるため）
async function pixels(blob: Blob): Promise<{ width: number; height: number; data: Uint8ClampedArray }> {
  let source: CanvasImageSource & { width: number; height: number };
  try {
    source = await createImageBitmap(blob, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
  } catch {
    const url = URL.createObjectURL(blob);
    try {
      source = await new Promise<HTMLImageElement>((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error('地形データの画像を読めませんでした'));
        img.src = url;
      });
    } finally {
      setTimeout(() => URL.revokeObjectURL(url), 0);
    }
  }
  const canvas = document.createElement('canvas');
  canvas.width = source.width;
  canvas.height = source.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true, colorSpace: 'srgb' });
  if (!ctx) throw new Error('この端末では地形データを表示できません');
  ctx.drawImage(source, 0, 0);
  return { width: canvas.width, height: canvas.height, data: ctx.getImageData(0, 0, canvas.width, canvas.height).data };
}

export async function decodeGrid(pkg: AreaPackage): Promise<TerrainGrid> {
  const [t, a] = await Promise.all([pixels(pkg.files['terrain.png']), pixels(pkg.files['access.png'])]);
  const { width, height } = pkg.manifest.grid;
  if (t.width !== width || t.height !== height || a.width !== width || a.height !== height) {
    throw new Error('地形データの大きさが manifest と一致しません');
  }
  return { width, height, terrain: t.data, access: a.data };
}

export async function decodeRoads(pkg: AreaPackage): Promise<RoadLine[]> {
  return JSON.parse(await pkg.files['roads.json'].text()) as RoadLine[];
}
