import { VectorTile } from '@mapbox/vector-tile';
import { PbfReader } from 'pbf';
import { nearestLineDistanceM, riverDistanceText, type LatLng } from './rivers';

// 地図の河川（国土地理院 ベクトルタイル experimental_bvmap の river 層、1/25,000）。3D だけで使う（電波が必要）
// 52xx = 水涯線（幅のある川の岸）、53xx = 河川中心線。設計: icarus_3d2_forest_water_context_audit.md §2-1
// このファイルは 3D の画面からだけ読む（asset-manifest から外れる lazy chunk に入る）

export const GSI_VECTOR_TILES = 'https://cyberjapandata.gsi.go.jp/xyz/experimental_bvmap/{z}/{x}/{y}.pbf';
export const RIVER_CENTER_CODES = [5301, 5302, 5321, 5322];
export const RIVER_EDGE_CODES = [5201, 5202, 5203];
const Z = 14; // パッケージ作成と同じ（地図の河川線はこのズームで全部入っている）

export { nearestLineDistanceM };

export function tileOf(lat: number, lng: number, z = Z): { x: number; y: number } {
  const n = 2 ** z;
  return { x: ((lng + 180) / 360) * n, y: ((1 - Math.asinh(Math.tan((lat * Math.PI) / 180)) / Math.PI) / 2) * n };
}

function latLngOf(x: number, y: number, z = Z): LatLng {
  const n = 2 ** z;
  return [(Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n))) * 180) / Math.PI, (x / n) * 360 - 180];
}

const tileCache = new Map<string, Promise<LatLng[][]>>();
function riverLines(tx: number, ty: number): Promise<LatLng[][]> {
  const key = `${tx}/${ty}`;
  let p = tileCache.get(key);
  if (!p) {
    p = (async () => {
      const res = await fetch(GSI_VECTOR_TILES.replace('{z}', String(Z)).replace('{x}', String(tx)).replace('{y}', String(ty)));
      if (res.status === 404) return []; // 海など
      if (!res.ok) throw new Error(`river tile ${res.status}`);
      const layer = new VectorTile(new PbfReader(new Uint8Array(await res.arrayBuffer()))).layers.river;
      const out: LatLng[][] = [];
      if (!layer) return out;
      for (let i = 0; i < layer.length; i++) {
        const f = layer.feature(i);
        const code = Number(f.properties.ftCode);
        if (!RIVER_CENTER_CODES.includes(code) && !RIVER_EDGE_CODES.includes(code)) continue;
        for (const ring of f.loadGeometry()) out.push(ring.map((pt) => latLngOf(tx + pt.x / layer.extent, ty + pt.y / layer.extent)));
      }
      return out;
    })();
    p.catch(() => tileCache.delete(key)); // 失敗は次に押した時に取り直す
    tileCache.set(key, p);
  }
  return p;
}

// 押した地点の周り 3×3 枚（約 5km 四方）。見つからない時は、確実に調べた半径（1 枚の幅）以上と返す
export async function nearestMapRiver(lat: number, lng: number): Promise<{ m: number; beyond: boolean }> {
  const { x, y } = tileOf(lat, lng);
  const tx = Math.floor(x), ty = Math.floor(y);
  const lists = await Promise.all([-1, 0, 1].flatMap((dx) => [-1, 0, 1].map((dy) => riverLines(tx + dx, ty + dy))));
  const d = nearestLineDistanceM([lat, lng], lists.flat());
  const tileWidthM = (40075016 * Math.cos((lat * Math.PI) / 180)) / 2 ** Z;
  return d === null || d > tileWidthM ? { m: tileWidthM, beyond: true } : { m: d, beyond: false };
}

export function mapRiverText(r: { m: number; beyond: boolean }): string {
  return `地図の河川 ${riverDistanceText(r.m)}${r.beyond ? ' 以上' : ''}`;
}
