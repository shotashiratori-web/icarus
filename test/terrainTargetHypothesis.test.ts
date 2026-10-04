import { describe, expect, it } from 'vitest';
import { buildCoverageMask } from '../src/terrain/coverage';
import { gridToLatLng } from '../src/terrain/engine';
import type { ForestData, ForestStand } from '../src/terrain/forest';
import {
  buildSnapshot, compileHypothesis, computeMatch, describeConditions, HYPOTHESIS_SCHEMA, NO_HYPOTHESIS_CONDITIONS, normalizeConditions,
  type HypothesisConditions, type MatchContext,
} from '../src/terrain/hypothesis';
import {
  buildTargetExploration, spotTargetStatus, STATE_CODE, STATE_LABEL, trackResultFor, targetKeys, type PointEvidence, type TargetSpec, type TrackEvidence,
} from '../src/terrain/targetExploration';
import type { TerrainGrid, TerrainManifest } from '../src/terrain/types';

// S4a: 対象ごとの探索実績（保存しない・表示時に計算）と、条件を重ねる（グループ内 OR・グループ間 AND）・仮説のスナップショット

const PX = 20;
const W = 40, H = 30;
function manifest(): TerrainManifest {
  return {
    areaId: 'yoichi-akaigawa', name: 't', version: 'v1', createdAt: '2026-09-29T00:00:00Z', bounds: { south: 43, north: 43.1, west: 140.8, east: 140.9 },
    grid: { width: W, height: H, pxM: PX, z: 14, tx0: 14600, ty0: 6010, factor: 3, cropX: 0, cropY: 0 },
    landKm2: 0, params: { date: '', slope_scale: 2.8, rel_scale: 170, ridge_dist_max_px: 10, access_dist_max_px: 40 },
    relPercentiles: { '50': 0.9, '60': 1, '70': 1, '80': 1.1, '90': 1.2 }, sources: [{ name: '国土地理院 DEM10', url: '' }], files: {} as TerrainManifest['files'],
  };
}
// 陸地。傾斜は x で増える（x=0 → 0°、x=39 → 39°）。道は x=0 の列に沿う（road px = x）、徒歩道は遠い
function grid(): TerrainGrid {
  const t = new Uint8ClampedArray(W * H * 4), a = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x;
    t.set([Math.round(x * 2.8), Math.round(1.2 * 170), 0, 255], i * 4);
    a.set([Math.min(x, 254), 255, 0, 255], i * 4);
  }
  return { width: W, height: H, terrain: t, access: a };
}
const ll = (x: number, y: number): [number, number] => { const p = gridToLatLng(manifest(), x + 0.5, y + 0.5); return [p.lat, p.lng]; };
const vtrack = (x: number): [number, number][][] => [[ll(x, 5), ll(x, 25)]];
const MAITAKE: TargetSpec = { speciesId: 'target-maitake', name: 'マイタケ', aliases: ['舞茸'] };
const NARATAKE: TargetSpec = { speciesId: 'target-naratake', name: 'ナラタケ', aliases: [] };

// 本番の 3 件を模す: 7/28 は同じ探索でマイタケ not_found とナラタケ found、9/26 はマイタケ not_found、ほかは対象なし
const TRACKS: TrackEvidence[] = [
  { segments: vtrack(10), exploredOn: '2026-07-28', targets: [{ target: 'マイタケ', result: 'not_found' }, { target: 'ナラタケ', result: 'found' }] },
  { segments: vtrack(20), exploredOn: '2026-09-26', targets: [{ target: 'マイタケ', result: 'not_found' }] },
  { segments: vtrack(30), exploredOn: '2025-10-01', targets: [] },
];

describe('対象ごとの探索実績', () => {
  it('1. 対象未選択では「探索済み」が今の探索範囲（buildCoverageMask）と格子単位で同じ', () => {
    const m = manifest();
    const te = buildTargetExploration(m, null, TRACKS, [], 50);
    const cov = buildCoverageMask(m, TRACKS.map((t) => t.segments), 50);
    for (let i = 0; i < cov.length; i++) expect(te.state[i] > 0 ? 1 : 0).toBe(cov[i]);
    expect(Math.max(...te.state)).toBe(STATE_CODE.walked);
  });

  it('2. マイタケ: 7/28・9/26 は「探して見つからず」、対象なしの探索は「歩いたが未記録」', () => {
    const k = targetKeys(MAITAKE);
    expect(trackResultFor(k, TRACKS[0])).toBe('notFound');
    expect(trackResultFor(k, TRACKS[1])).toBe('notFound');
    expect(trackResultFor(k, TRACKS[2])).toBe('walked');
    const te = buildTargetExploration(manifest(), MAITAKE, TRACKS, [], 50);
    expect(te.counts).toMatchObject({ tracks: 3, notFoundTracks: 2, foundTracks: 0, latest: '2026-09-26' });
  });

  it('3. ナラタケ: 7/28 は地点の無い「見つかった探索の軌跡」（見つかった地点とは別）', () => {
    const k = targetKeys(NARATAKE);
    expect(trackResultFor(k, TRACKS[0])).toBe('foundTrack');
    expect(trackResultFor(k, TRACKS[1])).toBe('walked');
    const m = manifest();
    const te = buildTargetExploration(m, NARATAKE, TRACKS, [], 50);
    expect(te.state[15 * W + 10]).toBe(STATE_CODE.foundTrack);
    expect(te.state[15 * W + 10]).not.toBe(STATE_CODE.foundPoint);
  });

  it('4. 名前の表記ゆれ（まいたけ・舞茸・？付き）は同じ対象。ほかの種は数えない', () => {
    const k = targetKeys(MAITAKE);
    const t = (target: string): TrackEvidence => ({ segments: [], exploredOn: null, targets: [{ target, result: 'not_found' }] });
    expect(trackResultFor(k, t('まいたけ'))).toBe('notFound');
    expect(trackResultFor(k, t('舞茸'))).toBe('notFound');
    expect(trackResultFor(k, t('マイタケ？'))).toBe('notFound');
    expect(trackResultFor(k, t('ナラタケ'))).toBe('walked');
  });

  it('5. 点の証拠: 見つかった地点は 50m で塗り、軌跡の「見つからず」より優先。観察の not_found も点で出る。最終探索日は最大', () => {
    const m = manifest();
    const pts: PointEvidence[] = [
      { lat: ll(10, 15)[0], lng: ll(10, 15)[1], name: 'まいたけ', result: 'found', date: '2026-09-30' },
      { lat: ll(35, 15)[0], lng: ll(35, 15)[1], name: 'マイタケ', result: 'not_found', date: '2026-09-30' },
      { lat: ll(5, 5)[0], lng: ll(5, 5)[1], name: 'ナラタケ', result: 'found', date: '2026-09-30' },
    ];
    const te = buildTargetExploration(m, MAITAKE, TRACKS, pts, 50, 50);
    expect(te.state[15 * W + 10]).toBe(STATE_CODE.foundPoint);
    expect(te.state[15 * W + 12]).toBe(STATE_CODE.foundPoint); // 40m 先も 50m 以内
    expect(te.state[15 * W + 35]).toBe(STATE_CODE.notFound);
    expect(te.state[5 * W + 5]).toBe(STATE_CODE.unexplored); // ナラタケの点はマイタケに数えない
    expect(te.counts).toMatchObject({ foundPoints: 1, notFoundPoints: 1, latest: '2026-09-30' });
    expect(new Date(te.lastDay[15 * W + 10] * 86400000).toISOString().slice(0, 10)).toBe('2026-09-30');
  });

  it('6. 対象未選択では点の証拠を使わない（何が見つかったか決まらないため）', () => {
    const te = buildTargetExploration(manifest(), null, [], [{ lat: ll(10, 15)[0], lng: ll(10, 15)[1], name: 'マイタケ', result: 'found', date: null }], 50);
    expect(Math.max(...te.state)).toBe(0);
  });
});

// 森林: 左半分（x<20）は林分 1（ミズナラ 1 位）、右半分は林分 2（ミズナラ 3 位）。植生は上半分（y<15）がミズナラ系群落
function forest(): ForestData {
  const stand = new Uint16Array(W * H), veg = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { stand[y * W + x] = x < 20 ? 1 : 2; veg[y * W + x] = y < 15 ? 1 : 2; }
  const st = (rank: 1 | 3): ForestStand => ({ owner: 'k', year: 2018, name: '', species: rank === 1 ? [['ミズナラ', null], ['シラカバ', null]] : [['トドマツ', null], ['カンバ', null], ['ミズナラ', null]], age: null, type: null, mizunaraRank: rank, cls: 0 });
  return {
    width: W, height: H, stand, veg, stands: [st(1), st(3)],
    vegs: [{ code: '1', name: 'ミズナラ群落', year: 2022, mizunara: true }, { code: '2', name: 'ササ群落', year: 2022, mizunara: false }],
    sources: { kokuyu: { name: '国有林', year: 2018 }, veg: { name: '植生図', years: [2021, 2022] } },
  };
}
function ctx(te = buildTargetExploration(manifest(), MAITAKE, TRACKS, [], 50)): MatchContext {
  return { m: manifest(), grid: grid(), forest: forest(), hydro: null, te, trees: [{ lat: ll(35, 25)[0], lng: ll(35, 25)[1], treeSpeciesId: 'tree-mizunara' }], today: new Date('2026-10-01T00:00:00Z') };
}
const cells = (c: HypothesisConditions, x = ctx()) => computeMatch(x, compileHypothesis(x, c)).matchCells;

describe('条件を重ねる（グループ内 OR・グループ間 AND）', () => {
  it('7. 条件が無ければ塗らない。グループを足すたびに範囲は増えない', () => {
    expect(cells(NO_HYPOTHESIS_CONDITIONS)).toBe(0);
    const a = cells({ ...NO_HYPOTHESIS_CONDITIONS, forestPlan: { mizunaraRanks: [1, 3] } });
    const b = cells({ ...NO_HYPOTHESIS_CONDITIONS, forestPlan: { mizunaraRanks: [1, 3] }, vegetation: { communities: ['ミズナラ群落'] } });
    const c = cells({ ...NO_HYPOTHESIS_CONDITIONS, forestPlan: { mizunaraRanks: [1, 3] }, vegetation: { communities: ['ミズナラ群落'] }, exploration: { states: ['unexplored'], lastExploredBeforeMonths: null } });
    expect(a).toBe(W * H);
    expect(b).toBeLessThan(a);
    expect(c).toBeLessThan(b);
  });

  it('8. 森林計画と植生図は別の証拠: 片方だけなら片方の範囲、両方 ON の時だけ重なり（AND）', () => {
    const fp = cells({ ...NO_HYPOTHESIS_CONDITIONS, forestPlan: { mizunaraRanks: [1] } });
    const vg = cells({ ...NO_HYPOTHESIS_CONDITIONS, vegetation: { communities: ['ミズナラ群落'] } });
    const both = cells({ ...NO_HYPOTHESIS_CONDITIONS, forestPlan: { mizunaraRanks: [1] }, vegetation: { communities: ['ミズナラ群落'] } });
    expect(fp).toBe(20 * H);
    expect(vg).toBe(W * 15);
    expect(both).toBe(20 * 15);
  });

  it('9. ミズナラ 1〜3 位は潰さない: 1 位だけ／3 位だけ／両方（グループ内は OR）', () => {
    expect(cells({ ...NO_HYPOTHESIS_CONDITIONS, forestPlan: { mizunaraRanks: [1] } })).toBe(20 * H);
    expect(cells({ ...NO_HYPOTHESIS_CONDITIONS, forestPlan: { mizunaraRanks: [3] } })).toBe(20 * H);
    expect(cells({ ...NO_HYPOTHESIS_CONDITIONS, forestPlan: { mizunaraRanks: [2] } })).toBe(0);
    expect(cells({ ...NO_HYPOTHESIS_CONDITIONS, forestPlan: { mizunaraRanks: [1, 3] } })).toBe(W * H);
  });

  it('10. 探索実績: 未探索・見つからず。「○か月以上前」は未探索も含む', () => {
    const notFound = cells({ ...NO_HYPOTHESIS_CONDITIONS, exploration: { states: ['notFound'], lastExploredBeforeMonths: null } });
    const walked = cells({ ...NO_HYPOTHESIS_CONDITIONS, exploration: { states: ['walked'], lastExploredBeforeMonths: null } });
    const old = cells({ ...NO_HYPOTHESIS_CONDITIONS, exploration: { states: [], lastExploredBeforeMonths: 6 } });
    const unexplored = cells({ ...NO_HYPOTHESIS_CONDITIONS, exploration: { states: ['unexplored'], lastExploredBeforeMonths: null } });
    expect(notFound).toBeGreaterThan(0);
    expect(walked).toBeGreaterThan(0);
    expect(old).toBe(unexplored + walked); // 2025-10 の探索（12 か月前）は含み、7/28・9/26 は含まない
  });

  it('11. 現地確認の木から ○m 以内・アクセスはどちらか（OR）', () => {
    expect(cells({ ...NO_HYPOTHESIS_CONDITIONS, confirmedTrees: { treeSpeciesId: 'tree-mizunara', treeName: 'ミズナラ', withinM: 50 } })).toBeGreaterThan(0);
    expect(cells({ ...NO_HYPOTHESIS_CONDITIONS, confirmedTrees: { treeSpeciesId: 'tree-buna', treeName: 'ブナ', withinM: 200 } })).toBe(0);
    // 道は x の列ごとに x 格子（20m）。100m 以内 = x<=5
    expect(cells({ ...NO_HYPOTHESIS_CONDITIONS, access: { roadWithinM: 100, trailWithinM: null } })).toBe(6 * H);
    expect(cells({ ...NO_HYPOTHESIS_CONDITIONS, access: { roadWithinM: 100, trailWithinM: 300 } })).toBe(6 * H); // 徒歩道は遠い
  });

  it('12. 地形: 傾斜の条件と組み合わせると、その分だけ減る', () => {
    const t = cells({ ...NO_HYPOTHESIS_CONDITIONS, terrain: { candidate: { slopeMinDeg: 30, sunTopPct: 50, ridgeMaxM: 63 }, dem: null } });
    expect(t).toBe(10 * H); // x>=30
    const t2 = cells({ ...NO_HYPOTHESIS_CONDITIONS, terrain: { candidate: { slopeMinDeg: 30, sunTopPct: 50, ridgeMaxM: 63 }, dem: null }, forestPlan: { mizunaraRanks: [1] } });
    expect(t2).toBe(0); // 傾斜 30° 以上は右半分（3 位）だけ
  });

  it('13. 森林データの無い版では森林の条件は「判定できない」と出し、範囲にしない', () => {
    const x = { ...ctx(), forest: null };
    const ch = compileHypothesis(x, { ...NO_HYPOTHESIS_CONDITIONS, forestPlan: { mizunaraRanks: [1] } });
    expect(ch.missing).toContain('forestPlan');
    expect(computeMatch(x, ch).matchCells).toBe(0);
  });

  it('14. 条件の文: データの年を付け、植生図は「ミズナラ系群落」と書く', () => {
    const text = describeConditions(
      { ...NO_HYPOTHESIS_CONDITIONS, forestPlan: { mizunaraRanks: [2, 1] }, vegetation: { communities: ['ミズナラ群落'] }, exploration: { states: ['unexplored'], lastExploredBeforeMonths: null } },
      MAITAKE, { forestPlan: '国有林 2018', vegetation: '2021〜2022' }, (s) => STATE_LABEL[s],
    );
    expect(text[0]).toBe('森林計画（国有林 2018）ミズナラ 1位・2位');
    expect(text[1]).toContain('植生図（2021〜2022調査）ミズナラ系群落');
    expect(text[2]).toBe('未探索（マイタケ）');
  });
});

describe('仮説のスナップショット（hypothesis_json）', () => {
  it('15. 条件・対象・データの版・点の半径・探索幅・面積・schema・アプリの版を固定する。空のグループは null', () => {
    const x = ctx();
    const cond: HypothesisConditions = { ...NO_HYPOTHESIS_CONDITIONS, forestPlan: { mizunaraRanks: [1] }, vegetation: { communities: [] }, exploration: { states: ['unexplored'], lastExploredBeforeMonths: null } };
    const result = computeMatch(x, compileHypothesis(x, cond));
    const snap = buildSnapshot({
      id: 'h1', name: '舞茸A', now: new Date('2026-10-05T00:00:00Z'), target: { speciesId: MAITAKE.speciesId, name: MAITAKE.name },
      m: x.m, forest: x.forest, hydroPresent: false,
      evidence: { period: 'all', purposeFilter: 'all', tracks: 3, foundTracks: 0, notFoundTracks: 2, foundPoints: 0, notFoundPoints: 2, latestExploredOn: '2026-09-30', confirmedTrees: 0 },
      coverageWidthM: 50, pointRadiusM: 50, conditions: cond, conditionText: ['a'], result, appBuild: 'abc1234',
    });
    expect(snap.schema).toBe(HYPOTHESIS_SCHEMA);
    expect(snap.target).toEqual({ speciesId: 'target-maitake', name: 'マイタケ' });
    expect(snap.data.terrainVersion).toBe('v1');
    expect(snap.data.forest.sources).toMatchObject({ kokuyu: { year: 2018 }, veg: { years: [2021, 2022] } });
    expect(snap.data.demDerived.present).toBe(false);
    expect(snap.data.evidence.notFoundTracks).toBe(2);
    expect(snap.params).toEqual({ coverageWidthM: 50, pointRadiusM: 50, pxM: PX });
    expect(snap.conditions.vegetation).toBeNull();
    expect(snap.conditions.forestPlan).toEqual({ species: 'ミズナラ', ranks: [1] }); // 古い形（mizunaraRanks）はミズナラとして保存
    expect(snap.summary.matchCells).toBe(result.matchCells);
    expect(snap.app.build).toBe('abc1234');
    expect(JSON.stringify(snap)).not.toMatch(/@/); // メールアドレスを入れない
    // 元の条件を後で変えても、スナップショットは変わらない
    (cond.forestPlan as { mizunaraRanks: number[] }).mizunaraRanks.push(3);
    expect(snap.conditions.forestPlan).toEqual({ species: 'ミズナラ', ranks: [1] });
  });

  it('16. normalizeConditions: 地形の両方が無ければ null・アクセスの両方が無ければ null', () => {
    const n = normalizeConditions({ ...NO_HYPOTHESIS_CONDITIONS, terrain: { candidate: null, dem: null }, access: { roadWithinM: null, trailWithinM: null } });
    expect(n.terrain).toBeNull();
    expect(n.access).toBeNull();
  });
});

describe('環境スポットの強調（対象の観察）', () => {
  const k = targetKeys(MAITAKE);
  it('17. 対象を選んでいなければ強調しない。対象の観察が無ければ従来表示', () => {
    expect(spotTargetStatus(null, [{ name: 'マイタケ', result: 'not_found' }])).toBeNull();
    expect(spotTargetStatus(k, [])).toBeNull();
    expect(spotTargetStatus(k, [{ name: 'マイタケ', result: 'not_checked' }])).toBeNull();
  });
  it('18. ほかの種の結果は混ぜない（ナラタケ あり は マイタケ では無関係）', () => {
    expect(spotTargetStatus(k, [{ name: 'ナラタケ', result: 'found' }, { name: 'マイタケ', result: 'not_found' }])).toBe('notFound');
    expect(spotTargetStatus(k, [{ name: 'ナラタケ', result: 'found' }])).toBeNull();
  });
  it('19. 最新で上書きしない: 1 回でも あり なら見つかった（後で なし があっても）', () => {
    expect(spotTargetStatus(k, [{ name: 'まいたけ', result: 'found' }, { name: 'マイタケ', result: 'not_found' }])).toBe('found');
    expect(spotTargetStatus(k, [{ name: 'マイタケ', result: 'not_found' }, { name: '舞茸', result: 'not_found' }])).toBe('notFound');
  });
});

describe('森林計画の任意樹種（2026-10-04）', () => {
  it('17. 樹種＋順位: トドマツ 1位・カンバ類（シラカバ・カンバを含む）・シラカンバ（国有林のカンバは含まない）', () => {
    expect(cells({ ...NO_HYPOTHESIS_CONDITIONS, forestPlan: { species: 'トドマツ', ranks: [1] } })).toBe(20 * H); // 右半分（3位側の林分）の 1 位
    expect(cells({ ...NO_HYPOTHESIS_CONDITIONS, forestPlan: { species: 'カンバ類', ranks: [2] } })).toBe(W * H); // 左=シラカバ 2位・右=カンバ 2位
    expect(cells({ ...NO_HYPOTHESIS_CONDITIONS, forestPlan: { species: 'シラカンバ', ranks: [2] } })).toBe(20 * H); // 左のシラカバだけ
    expect(cells({ ...NO_HYPOTHESIS_CONDITIONS, forestPlan: { species: 'ミズナラ', ranks: [1, 3] } })).toBe(cells({ ...NO_HYPOTHESIS_CONDITIONS, forestPlan: { mizunaraRanks: [1, 3] } }));
  });
  it('18. グループで保存すると中身（members）も残る。条件の文に樹種名', () => {
    const n = normalizeConditions({ ...NO_HYPOTHESIS_CONDITIONS, forestPlan: { species: 'カンバ類', ranks: [3, 1] } });
    expect(n.forestPlan).toEqual({ species: 'カンバ類', ranks: [1, 3], members: ['カンバ', 'シラカンバ', 'ダケカンバ', 'ウダイカンバ', 'その他カンバ'] });
    const t = describeConditions({ ...NO_HYPOTHESIS_CONDITIONS, forestPlan: { species: 'トドマツ', ranks: [1, 2] } }, null, { forestPlan: '国有林 2018・民有林 2023', vegetation: null }, (s) => STATE_LABEL[s]);
    expect(t[0]).toBe('森林計画（国有林 2018・民有林 2023）トドマツ 1位・2位');
  });
});
