// 地理院の標高タイル（dem_png・ズーム 14・約 10m）から、点の標高を取る（ルート予定の登り下り用。電波が要る）。
// 3D の地形（gsiDem.ts）と同じ出どころ。タイルは 1 回の呼び出しの中で使い回す
const Z = 14;
export function gsiPngHeight(r: number, g: number, b: number): number | null {
  const x = r * 65536 + g * 256 + b;
  if (x === 8388608) return null; // 2^23 = データなし
  return (x < 8388608 ? x : x - 16777216) * 0.01;
}
type Loader = (url: string) => Promise<ImageData>;
async function defaultLoader(url: string): Promise<ImageData> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`標高タイルを取れませんでした（${res.status}）`);
  const bmp = await createImageBitmap(await res.blob());
  const c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height;
  const ctx = c.getContext('2d'); if (!ctx) throw new Error('canvas が使えません');
  ctx.drawImage(bmp, 0, 0); return ctx.getImageData(0, 0, bmp.width, bmp.height);
}
// 取れない点（海・データなし）は、近い点の値で埋める。1 点も取れなければ null
export async function fetchElevations(points: { lat: number; lng: number }[], load: Loader = defaultLoader): Promise<number[] | null> {
  const n = 2 ** Z, tiles = new Map<string, Promise<ImageData>>();
  const out: (number | null)[] = [];
  for (const p of points) {
    const la = (p.lat * Math.PI) / 180;
    const fx = ((p.lng + 180) / 360) * n, fy = ((1 - Math.log(Math.tan(la) + 1 / Math.cos(la)) / Math.PI) / 2) * n;
    const tx = Math.floor(fx), ty = Math.floor(fy), key = `${tx}/${ty}`;
    if (!tiles.has(key)) tiles.set(key, load(`https://cyberjapandata.gsi.go.jp/xyz/dem_png/${Z}/${tx}/${ty}.png`));
    const img = await tiles.get(key)!;
    const px = Math.min(img.width - 1, Math.floor((fx - tx) * img.width)), py = Math.min(img.height - 1, Math.floor((fy - ty) * img.height));
    const j = (py * img.width + px) * 4;
    out.push(gsiPngHeight(img.data[j], img.data[j + 1], img.data[j + 2]));
  }
  if (out.every((h) => h === null)) return null;
  let last: number | null = out.find((h) => h !== null) ?? null;
  return out.map((h) => (h === null ? last! : (last = h)));
}
