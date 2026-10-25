import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import {
  closeRouteStoreForTest, deleteRoute, densify, distM, hoursText, lengthM, listRoutes, routeStats, routeToGpx, saveRoute, setRouteVisible, type RoutePlan,
} from '../src/exploration/routePlan';
import { fetchElevations, gsiPngHeight } from '../src/terrain/gsiElevation';

// ルート予定 v1（icarus_route_plan_v1_design.md）

const A = { lat: 43.1, lng: 140.85 }, B = { lat: 43.1, lng: 140.86 }; // 東へ約 812m
describe('距離と点の分け方', () => {
  it('2 点の距離・合計・10m ごとの点', () => {
    expect(distM(A, B)).toBeGreaterThan(805); expect(distM(A, B)).toBeLessThan(820);
    expect(lengthM([A, B, A])).toBeCloseTo(2 * distM(A, B), 3);
    const d = densify([A, B], 10); expect(d[0]).toEqual(A); expect(d[d.length - 1]).toEqual(B); expect(d.length).toBe(Math.ceil(distM(A, B) / 10) + 1);
  });
});
describe('登り下り・傾斜・時間の目安', () => {
  const pts = [A, B];
  const n = densify(pts).length;
  const up = Array.from({ length: n }, (_, i) => 100 + (300 * i) / (n - 1)); // 300m 登る
  it('山林探索（初期値）は 2km/時＋登り 300m で 1 時間', () => {
    const s = routeStats(pts, up, 'forest');
    expect(s.ascentM).toBeGreaterThanOrEqual(298); expect(s.descentM).toBe(0);
    expect(s.hours).toBeCloseTo(s.lengthM / 2000 + s.ascentM! / 300, 5);
    expect(s.maxSlopeDeg).toBeGreaterThan(15);
  });
  it('林道・道中心は 4km/時。山林探索より短い', () => {
    expect(routeStats(pts, up, 'road').hours!).toBeLessThan(routeStats(pts, up, 'forest').hours!);
  });
  it('2m 未満の揺れは数えない。標高が無ければ距離だけ', () => {
    const wobble = Array.from({ length: n }, (_, i) => 200 + (i % 2));
    expect(routeStats(pts, wobble, 'forest').ascentM).toBe(0);
    expect(routeStats(pts, null, 'forest')).toMatchObject({ ascentM: null, hours: null });
  });
  it('時間の書き方', () => {
    expect(hoursText(0.5)).toBe('約30分'); expect(hoursText(2)).toBe('約2時間'); expect(hoursText(2.25)).toBe('約2時間15分');
  });
});
describe('GPX の書き出し', () => {
  it('rte に点を順番に。名前・予定日・目的', () => {
    const r: RoutePlan = { id: 'x', name: 'M系 <試し>', plannedDate: '2026-10-27', purpose: 'シモフリシメジ', mode: 'forest', points: [A, B], elevations: null, createdAt: '', visible: true };
    const g = routeToGpx(r);
    expect(g).toContain('<name>M系 &lt;試し&gt;</name>'); expect(g).toContain('予定日 2026-10-27・目的 シモフリシメジ');
    expect(g.match(/<rtept /g)).toHaveLength(2); expect(g.indexOf('140.850000')).toBeLessThan(g.indexOf('140.860000'));
  });
});
describe('端末に保存', () => {
  afterEach(async () => { for (const r of await listRoutes()) await deleteRoute(r.id); await closeRouteStoreForTest(); });
  it('保存・一覧（新しい順）・表示する／しない・消す', async () => {
    const base = { name: 'a', plannedDate: null, purpose: '', mode: 'forest' as const, points: [A, B], elevations: null, visible: true };
    await saveRoute({ ...base, id: '1', createdAt: '2026-10-01' }); await saveRoute({ ...base, id: '2', createdAt: '2026-10-02' });
    expect((await listRoutes()).map((r) => r.id)).toEqual(['2', '1']);
    await setRouteVisible('1', false); expect((await listRoutes()).find((r) => r.id === '1')?.visible).toBe(false);
    await deleteRoute('2'); expect((await listRoutes()).map((r) => r.id)).toEqual(['1']);
  });
});
describe('標高タイル', () => {
  it('地理院の PNG の値（負の値・データなし）', () => {
    expect(gsiPngHeight(0, 0x27, 0x10)).toBeCloseTo(100, 5);
    expect(gsiPngHeight(128, 0, 0)).toBeNull();
    expect(gsiPngHeight(255, 255, 156)).toBeCloseTo(-1, 5);
  });
  it('点ごとに標高。タイルは使い回す。データなしは近い値で埋める', async () => {
    let calls = 0;
    const img = (v: [number, number, number]) => ({ width: 2, height: 2, data: new Uint8ClampedArray([...v, 255, ...v, 255, ...v, 255, ...v, 255]) }) as unknown as ImageData;
    const load = async () => { calls++; return calls === 1 ? img([0, 0x27, 0x10]) : img([128, 0, 0]); };
    const h = await fetchElevations([A, { lat: 43.1, lng: 140.8501 }], load);
    expect(h).toEqual([100, 100]); expect(calls).toBe(1);
  });
});
