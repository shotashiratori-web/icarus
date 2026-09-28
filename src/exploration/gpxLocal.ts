import type { PendingPreview, TrackSegments } from './types';

// 端末側の GPX 読み取り（保存前の確認と、未送信の間の地図表示だけに使う）。
// 登録の値（距離・日付など）はサーバーが R2 の原本から計算し直す（端末の値は信用されない）

export class LocalGpxError extends Error {}

export async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function haversine(a: [number, number], b: [number, number]): number {
  const R = 6371008.8;
  const r = Math.PI / 180;
  const dLat = (b[0] - a[0]) * r;
  const dLng = (b[1] - a[1]) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function jstDate(ms: number): string {
  return new Date(ms + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

export function previewGpx(bytes: ArrayBuffer): PendingPreview {
  const text = new TextDecoder('utf-8').decode(bytes);
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length > 0 || !doc.getElementsByTagName('gpx').length) {
    throw new LocalGpxError('GPX ファイルではありません');
  }
  const segs: Element[][] = [];
  for (const seg of Array.from(doc.getElementsByTagName('trkseg'))) segs.push(Array.from(seg.getElementsByTagName('trkpt')));
  for (const rte of Array.from(doc.getElementsByTagName('rte'))) segs.push(Array.from(rte.getElementsByTagName('rtept')));
  const track: TrackSegments = [];
  let distance = 0;
  let count = 0;
  let tMin: number | null = null;
  let s = 90, n = -90, w = 180, e = -180;
  for (const els of segs) {
    const pts: [number, number][] = [];
    for (const el of els) {
      const lat = Number(el.getAttribute('lat'));
      const lng = Number(el.getAttribute('lon'));
      if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) continue;
      count++;
      if (pts.length) distance += haversine(pts[pts.length - 1], [lat, lng]);
      pts.push([lat, lng]);
      if (lat < s) s = lat; if (lat > n) n = lat; if (lng < w) w = lng; if (lng > e) e = lng;
      const t = Date.parse(el.getElementsByTagName('time')[0]?.textContent?.trim() ?? '');
      if (Number.isFinite(t)) tMin = tMin === null ? t : Math.min(tMin, t);
    }
    if (pts.length) track.push(pts);
  }
  if (count === 0) throw new LocalGpxError('GPX に経路の点がありません');
  const name = doc.querySelector('trk > name, rte > name, metadata > name')?.textContent?.trim() ?? '';
  return {
    exploredOn: tMin === null ? null : jstDate(tMin),
    startedAt: tMin === null ? null : new Date(tMin).toISOString(),
    distanceM: Math.round(distance * 10) / 10,
    pointCount: count,
    bbox: { south: s, north: n, west: w, east: e },
    trackName: name,
    track,
  };
}
