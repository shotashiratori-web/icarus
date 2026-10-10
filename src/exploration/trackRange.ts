// 探索として使う区間（Track Range v1）。設計: icarus/docs/architecture/icarus_exploration_track_range_v1_design.md
// - 原本は変えない。サーバーの区間（開始・終了の UNIX 秒、null = 全区間）で表示用の軌跡を切るだけ
// - 車の区間の判定は「候補を人に示す」だけ。自動では何も切らない（確定は管理者が理由を書いて行う）
// - 判定の規則は Audit（docs/reports/exploration_end_detection_audit_2026-10-09.md）で 8 本すべて正しかったもの:
//   前後 60 秒の平均で 10km/h 超が 2 分以上・300m 以上続く区間 = 乗り物

import type { TrackSegments } from './types';

// 時刻つきの軌跡（セグメントごと）。[lat, lng, UNIX 秒 | null]
export type TimedTrack = [number, number, number | null][][];
export interface UseRange { fromS: number; toS: number }

const VEHICLE_WINDOW_S = 60; // 前後 60 秒（±30 秒）の平均速度
const VEHICLE_SPEED_MPS = 10 / 3.6;
const VEHICLE_MIN_S = 120;
const VEHICLE_MIN_M = 300;

export function distanceM(a: [number, number], b: [number, number]): number {
  const R = 6371008.8;
  const toRad = Math.PI / 180;
  const dLat = (b[0] - a[0]) * toRad;
  const dLng = (b[1] - a[1]) * toRad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * toRad) * Math.cos(b[0] * toRad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function trackDistanceM(track: TrackSegments): number {
  let d = 0;
  for (const seg of track) for (let i = 1; i < seg.length; i++) d += distanceM(seg[i - 1], seg[i]);
  return d;
}

// 端末に古い形（時刻なし [lat, lng]）で写した軌跡かどうか
export const isTimed = (t: TimedTrack | TrackSegments): t is TimedTrack => t.some((seg) => seg.some((p) => p.length >= 3));

export const toLatLng = (t: TimedTrack | TrackSegments): TrackSegments => t.map((seg) => seg.map((p) => [p[0], p[1]] as [number, number]));

// 使う区間で切る（時刻が区間の外の点を落とす）。時刻の無い点は判断できないので残す
export function clipTrack(track: TimedTrack, range: UseRange | null): TrackSegments {
  if (!range) return toLatLng(track);
  const out: TrackSegments = [];
  for (const seg of track) {
    const kept = seg.filter((p) => p[2] === null || (p[2] >= range.fromS && p[2] <= range.toS)).map((p) => [p[0], p[1]] as [number, number]);
    if (kept.length >= 2) out.push(kept);
  }
  return out;
}

// 区間の外（外す部分）。編集中の灰色の破線に使う
export function excludedParts(track: TimedTrack, range: UseRange): TrackSegments {
  const out: TrackSegments = [];
  for (const seg of track) {
    let run: [number, number][] = [];
    // 境目の点を両側に含めて、青と灰色の線をつなげる
    seg.forEach((p, i) => {
      const outside = p[2] !== null && (p[2] < range.fromS || p[2] > range.toS);
      const prevOut = i > 0 && seg[i - 1][2] !== null && (seg[i - 1][2]! < range.fromS || seg[i - 1][2]! > range.toS);
      if (outside) {
        if (run.length === 0 && i > 0) run.push([seg[i - 1][0], seg[i - 1][1]]);
        run.push([p[0], p[1]]);
      } else if (prevOut) {
        run.push([p[0], p[1]]);
        out.push(run);
        run = [];
      }
    });
    if (run.length >= 2) out.push(run);
  }
  return out;
}

interface Pt { lat: number; lng: number; t: number; d: number } // d = 最初の点からの累積距離

function flatten(track: TimedTrack): Pt[] {
  const pts: Pt[] = [];
  for (const seg of track) {
    let prev: [number, number] | null = null;
    for (const p of seg) {
      if (p[2] === null) continue;
      // セグメントの切れ目は距離を足さない（記録の中断）
      const step = prev ? distanceM(prev, [p[0], p[1]]) : 0;
      pts.push({ lat: p[0], lng: p[1], t: p[2], d: (pts.length ? pts[pts.length - 1].d : 0) + step });
      prev = [p[0], p[1]];
    }
  }
  return pts.sort((a, b) => a.t - b.t);
}

export interface Interval { fromS: number; toS: number; distanceM: number }

// 乗り物の区間（候補を示すためだけに使う）
export function detectVehicleIntervals(track: TimedTrack): Interval[] {
  const pts = flatten(track);
  if (pts.length < 2) return [];
  const half = VEHICLE_WINDOW_S / 2;
  const fast: boolean[] = new Array(pts.length).fill(false);
  let lo = 0, hi = 0;
  for (let i = 0; i < pts.length; i++) {
    while (pts[lo].t < pts[i].t - half) lo++;
    if (hi < i) hi = i;
    while (hi + 1 < pts.length && pts[hi + 1].t <= pts[i].t + half) hi++;
    const dt = pts[hi].t - pts[lo].t;
    fast[i] = dt > 0 && (pts[hi].d - pts[lo].d) / dt > VEHICLE_SPEED_MPS;
  }
  const out: Interval[] = [];
  let i = 0;
  while (i < pts.length) {
    if (!fast[i]) { i++; continue; }
    let j = i;
    while (j + 1 < pts.length && fast[j + 1]) j++;
    const dur = pts[j].t - pts[i].t, dist = pts[j].d - pts[i].d;
    if (dur >= VEHICLE_MIN_S && dist >= VEHICLE_MIN_M) out.push({ fromS: pts[i].t, toS: pts[j].t, distanceM: dist });
    i = j + 1;
  }
  return out;
}

// 候補: 乗り物の区間を除いた、いちばん長い（距離）歩きの区間。乗り物が無ければ null（全区間のまま）
export function walkingCandidate(track: TimedTrack): { candidate: UseRange | null; vehicles: Interval[] } {
  const vehicles = detectVehicleIntervals(track);
  const pts = flatten(track);
  if (vehicles.length === 0 || pts.length < 2) return { candidate: null, vehicles };
  let best: Interval | null = null;
  let start = 0;
  const consider = (a: number, b: number) => {
    if (b <= a) return;
    const dist = pts[b].d - pts[a].d;
    if (!best || dist > best.distanceM) best = { fromS: pts[a].t, toS: pts[b].t, distanceM: dist };
  };
  for (const v of vehicles) {
    const vi = pts.findIndex((p) => p.t >= v.fromS);
    consider(start, vi);
    start = pts.findIndex((p) => p.t >= v.toS);
  }
  consider(start, pts.length - 1);
  const b = best as Interval | null;
  return { candidate: b ? { fromS: b.fromS, toS: b.toS } : null, vehicles };
}

export function timeBounds(track: TimedTrack): UseRange | null {
  const pts = flatten(track);
  return pts.length < 2 ? null : { fromS: pts[0].t, toS: pts[pts.length - 1].t };
}

// 表示用: JST の 時:分
export const hhmm = (s: number) => new Date((s + 9 * 3600) * 1000).toISOString().slice(11, 16);
