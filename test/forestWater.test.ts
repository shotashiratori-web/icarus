import { describe, expect, it } from 'vitest';
import { forestRanks, inspectSpot, renderDemStreams, renderTwi, twiRank } from '../src/terrain/forestWater';
import { mapRiverText, nearestLineDistanceM } from '../src/terrain/gsiRivers';
import type { EnvironmentSpot, SpotObservation } from '../src/environmentSpots/types';
import type { TerrainManifest } from '../src/terrain/types';
import type { HydroGrid } from '../src/terrain/hydro';

// 3D-2 Forest & Water Context（読み取り専用）。設計: icarus_3d2_forest_water_context_audit.md

const P = { '33': 4.976, '50': 5.531, '67': 6.234, '90': 8.692 }; // 余市・赤井川・仁木 20260929-6d7abae2
const manifest = { areaId: 'yoichi-akaigawa', twiPercentiles: P };
const areaName = (id: string) => (id === 'yoichi-akaigawa' ? '余市・赤井川・仁木' : id);

const obs = (over: Partial<SpotObservation>): SpotObservation => ({
  id: crypto.randomUUID(), observedAt: '2026-10-06T07:30:48.000Z', targetSpeciesId: 'target-maitake', target: 'マイタケ', targetText: '',
  result: 'found', foundStage: null, memo: '', status: 'active', createdByName: 't', createdAt: '', updatedAt: '', ...over,
});

const spot = (over: Partial<EnvironmentSpot>): EnvironmentSpot => ({
  id: 'ac1f1e37', title: 'ミズナラ（生木）', envType: 'tree', lifeState: 'alive', treeSpeciesId: 'tree-mizunara', treeSpecies: 'ミズナラ', treeSpeciesText: null,
  dbhCm: null, decayClass: null, lat: 43.1049, lng: 140.8626, locationSource: 'gps', gpsAccuracyM: 5, photoMissingReason: null, photoMissingMemo: null, photos: [], memo: '',
  terrain: {
    status: 'ok', areaId: 'yoichi-akaigawa', terrainVersion: '20260929-6d7abae2', slopeDeg: 11, sun: 0.87, ridgeM: 167, roadM: 105, aspectDeg: 309, aspect: '北西', landform: '谷',
    streamM: 105, stream: '沢の目安から約100m', twi: 9.7,
    forestStand: { owner: 'k', year: 2018, species: ['カンバ', 'ミズナラ', '他Ｌ'], mizunaraRank: 2 }, vegetation: { name: 'シラカンバ－ミズナラ群落', year: 2022 },
  },
  observedAt: '2026-10-06T07:30:48.000Z', status: 'active', createdByName: 't', createdAt: '', updatedAt: '',
  observations: [obs({ foundStage: 'prime' })], ...over,
});

const inspect = (s: EnvironmentSpot | null, over: Partial<Parameters<typeof inspectSpot>[0]> = {}) =>
  inspectSpot({ label: 'ミズナラ（生木）', envType: 'tree', lifeState: 'alive', remote: s, manifest, areaName, ...over });

describe('Tree Inspector', () => {
  it('1. 初舞茸の木: 観察・森・地形・水が一目で。胸高直径は未入力（—）、腐朽度は生木なので対象外', () => {
    const r = inspect(spot({}));
    expect(r.title).toBe('ミズナラ（生木）');
    expect(r.tree).toEqual({ dbh: null, decay: null, decayNote: '対象外（生木）' });
    expect(r.firstSeen).toBe('2026/10/6');
    expect(r.obsCount).toBe(1);
    expect(r.observations).toEqual([{ target: 'マイタケ', mark: '✓', result: 'あり', date: '2026/10/6', stage: '適期', more: 0 }]);
    expect(r.forest).toEqual({ ranks: 'カンバ1位・ミズナラ2位・他L3位', veg: 'シラカンバ－ミズナラ群落' });
    expect(r.terrain).toBe('谷 / 北西 / 11°');
    expect(r.water).toEqual({ twi: 'TWI 9.7（湿潤・エリア上位10%）', stream: '沢の目安 約100m' });
    expect(r.terrainNote).toBeNull();
  });

  it('2. 「なし」だけの木は ×。「見ていない」は回数に数えるが結果に出さない。同じ対象の過去は「ほか n 回」', () => {
    const r = inspect(spot({
      observations: [
        obs({ result: 'not_found', observedAt: '2026-09-30T00:14:16.000Z' }),
        obs({ result: 'not_found', observedAt: '2026-10-06T00:00:00.000Z' }),
        obs({ result: 'not_checked', targetSpeciesId: 'target-naratake', target: 'ナラタケ' }),
        obs({ result: 'found', status: 'archived' }),
      ],
    }));
    expect(r.obsCount).toBe(3);
    expect(r.observations).toEqual([{ target: 'マイタケ', mark: '×', result: 'なし', date: '2026/10/6', stage: null, more: 1 }]);
  });

  it('3. 立枯れは胸高直径・腐朽度を出す（入力がある時）', () => {
    const r = inspect(spot({ lifeState: 'snag', dbhCm: 82, decayClass: 2 }), { lifeState: 'snag' });
    expect(r.title).toBe('ミズナラ（立枯れ）');
    expect(r.tree).toEqual({ dbh: '82cm', decay: '2（一部腐朽）', decayNote: null });
  });

  it('4. 未送信の Spot は種類と「未送信」だけ。地形が取れていない記録は 2D と同じ文言', () => {
    const p = inspect(null);
    expect(p.pending).toBe(true);
    expect(p.observations).toEqual([]);
    const n = inspect(spot({ terrain: { status: 'not_saved', areaId: 'niseko-yotei', areaName: 'ニセコ・羊蹄' } }));
    expect(n.terrain).toBeNull();
    expect(n.terrainNote).toMatch(/取得できていません/);
  });

  it('5. 別の山域で記録した地形は TWI の数値だけ（位置づけは表示中の山域の分位では言わない）', () => {
    const t = { ...(spot({}).terrain as Record<string, unknown>), areaId: 'niseko-yotei' };
    expect(inspect(spot({ terrain: t })).water?.twi).toBe('TWI 9.7');
  });
});

describe('水を分ける', () => {
  it('6. TWI の位置づけ（山域の分位）', () => {
    expect(twiRank(9.7, P)).toBe('湿潤・エリア上位10%');
    expect(twiRank(7.0, P)).toBe('やや湿潤・エリア上位33%');
    expect(twiRank(5.5, P)).toBe('中くらい');
    expect(twiRank(4.6, P)).toBe('乾きやすい・エリア下位33%');
    expect(twiRank(9.7, undefined)).toBeNull();
    expect(forestRanks(['他Ｌ'])).toBe('他L1位');
  });

  it('7. 湿りやすさの層は上位 10% を濃く・33% を薄く、沢の目安の層は沢の格子だけ（海は塗らない）', () => {
    const m = { params: { twi_min: 2, twi_max: 18 }, twiPercentiles: P } as unknown as TerrainManifest;
    const lv = (v: number) => Math.round(((v - 2) / 16) * 31); // twiValue の逆
    const h: HydroGrid = { width: 4, height: 1, aspect: new Uint8Array(4), streamDist: new Uint8Array([0, 3, 0, 9]), twiLevel: new Uint8Array([lv(12), lv(7.5), lv(3), lv(12)]), landform: new Uint8Array([3, 3, 3, 0]) };
    const twi = new Uint8ClampedArray(16);
    expect(renderTwi(m, h, twi)).toBe(true);
    expect([twi[3], twi[7], twi[11], twi[15]]).toEqual([120, 50, 0, 0]);
    const st = new Uint8ClampedArray(16);
    renderDemStreams(h, st);
    expect([st[3] > 0, st[7] > 0, st[11] > 0, st[15] > 0]).toEqual([true, false, true, false]);
  });

  it('8. 地図の河川までの距離（折れ線までの最短）と表示', () => {
    const p: [number, number] = [43.1049, 140.8626];
    // 真北へ約 1.1km の東西の線
    const d = nearestLineDistanceM(p, [[[43.1049 + 1100 / 110540, 140.85], [43.1049 + 1100 / 110540, 140.88]]]);
    expect(d).toBeCloseTo(1100, 0);
    expect(nearestLineDistanceM(p, [])).toBeNull();
    expect(mapRiverText({ m: 1076, beyond: false })).toBe('地図の河川 約1.1km');
    expect(mapRiverText({ m: 240, beyond: false })).toBe('地図の河川 約240m');
    expect(mapRiverText({ m: 1792, beyond: true })).toBe('地図の河川 約1.8km 以上');
  });
});
