import { describe, expect, it } from 'vitest';
import { gridToLatLng } from '../src/terrain/engine';
import {
  buildTargetExploration, describeTargetAt, EXPLORATION_STATES, pointState, renderTargetExploration, spotTargetStatus, STATE_CODE, STATE_COLORS, stateAreasKm2,
  targetKeys, trackResultFor, type PointEvidence, type TargetSpec, type TrackEvidence,
} from '../src/terrain/targetExploration';
import type { TerrainManifest } from '../src/terrain/types';

// 探す対象の 3 状態（2026-10-20）: 見つかった（確定）／未確定（「？」付き）／見つからず。すべての探す対象に共通。
// 未確定は「見つかった」の数・塗りに入れない。色も模様も違う

const W = 40, H = 30;
const m: TerrainManifest = {
  areaId: 'a', name: 't', version: 'v1', createdAt: '', bounds: { south: 43, north: 43.1, west: 140.8, east: 140.9 },
  grid: { width: W, height: H, pxM: 20, z: 14, tx0: 14600, ty0: 6010, factor: 3, cropX: 0, cropY: 0 },
  landKm2: 0, params: {}, sources: [], files: {} as TerrainManifest['files'],
} as unknown as TerrainManifest;
const ll = (x: number, y: number): [number, number] => { const p = gridToLatLng(m, x + 0.5, y + 0.5); return [p.lat, p.lng]; };
const at = (x: number, y: number) => y * W + x;
const SHAKA: TargetSpec = { speciesId: 'target-shakashimeji', name: 'シャカシメジ', aliases: ['しゃかしめじ', '釈迦しめじ', 'センボンシメジ'] };
const MAITAKE: TargetSpec = { speciesId: 'target-maitake', name: 'マイタケ', aliases: ['舞茸'] };
const pt = (x: number, y: number, name: string, result: PointEvidence['result'] = 'found'): PointEvidence => { const [lat, lng] = ll(x, y); return { lat, lng, name, result, date: '2026-09-26' }; };

describe('点の状態', () => {
  it('「？」付きの見つかったは 未確定。名前は対象に紐づく（9/26「シャカしめじ？」）', () => {
    expect(pointState({ name: 'シャカしめじ？', result: 'found' })).toBe('uncertain');
    expect(pointState({ name: 'シャカシメジ', result: 'found' })).toBe('foundPoint');
    expect(pointState({ name: 'シャカしめじ？', result: 'not_found' })).toBe('notFound');
  });

  it('未確定は 見つかった の数・塗りに入れず、別の状態で塗る', () => {
    const te = buildTargetExploration(m, SHAKA, [], [pt(10, 10, 'シャカしめじ？')], 50, 40);
    expect(te.counts).toMatchObject({ foundPoints: 0, uncertainPoints: 1, notFoundPoints: 0 });
    expect(te.state[at(10, 10)]).toBe(STATE_CODE.uncertain);
    expect(Array.from(te.state).includes(STATE_CODE.foundPoint)).toBe(false);
    const a = stateAreasKm2(m, te);
    expect(a.foundPoint).toBe(0);
    expect(a.uncertain).toBeGreaterThan(0);
  });

  it('確定と未確定が重なれば 見つかった。未確定は 見つからず より上', () => {
    const te = buildTargetExploration(m, SHAKA, [], [pt(10, 10, 'シャカしめじ？'), pt(10, 10, 'センボンシメジ')], 50, 40);
    expect(te.state[at(10, 10)]).toBe(STATE_CODE.foundPoint);
    const te2 = buildTargetExploration(m, SHAKA, [], [pt(20, 10, 'シャカシメジ', 'not_found'), pt(20, 10, '釈迦しめじ？')], 50, 40);
    expect(te2.state[at(20, 10)]).toBe(STATE_CODE.uncertain);
  });

  it('シャカシメジ専用ではない（マイタケでも同じ）', () => {
    const te = buildTargetExploration(m, MAITAKE, [], [pt(5, 5, '舞茸？')], 50, 40);
    expect(te.counts.uncertainPoints).toBe(1);
    expect(te.counts.foundPoints).toBe(0);
  });
});

describe('探索の軌跡・スポットの観察', () => {
  const track = (target: string, result: 'found' | 'not_found'): TrackEvidence => ({ segments: [[ll(2, 2), ll(2, 20)]], exploredOn: '2026-09-26', targets: [{ target, result }] });
  it('軌跡: 「？」付きの見つかっただけなら 未確定。確定があれば 見つかった探索の軌跡', () => {
    const keys = targetKeys(SHAKA);
    expect(trackResultFor(keys, track('シャカしめじ？', 'found'))).toBe('uncertain');
    expect(trackResultFor(keys, track('シャカシメジ', 'found'))).toBe('foundTrack');
    expect(trackResultFor(keys, track('シャカシメジ', 'not_found'))).toBe('notFound');
    const te = buildTargetExploration(m, SHAKA, [track('シャカしめじ？', 'found')], [], 50);
    expect(te.counts).toMatchObject({ foundTracks: 0, uncertainTracks: 1 });
  });
  it('スポット: 確定 > 未確定 > 見つからず', () => {
    const keys = targetKeys(SHAKA);
    expect(spotTargetStatus(keys, [{ name: 'シャカしめじ？', result: 'found' }])).toBe('uncertain');
    expect(spotTargetStatus(keys, [{ name: 'シャカしめじ？', result: 'found' }, { name: 'シャカシメジ', result: 'found' }])).toBe('found');
    expect(spotTargetStatus(keys, [{ name: 'シャカシメジ', result: 'not_found' }, { name: 'シャカしめじ？', result: 'found' }])).toBe('uncertain');
  });
});

describe('表示', () => {
  it('地点の説明は「シャカシメジ（未確定・記録「…」）」', () => {
    const p = pt(10, 10, 'シャカしめじ？');
    const lines = describeTargetAt(SHAKA, [], [p], 50, 50, p.lat, p.lng, () => Infinity);
    expect(lines[0]).toContain('シャカシメジ（未確定・記録「シャカしめじ？」）');
    expect(lines[0]).not.toContain('見つかった（地点）');
  });
  it('色は確定の緑と別の琥珀色で、斜線（塗らない格子がある）', () => {
    expect(STATE_COLORS.uncertain).not.toEqual(STATE_COLORS.foundPoint);
    const te = buildTargetExploration(m, SHAKA, [], [pt(10, 10, 'シャカしめじ？')], 50, 80);
    const out = new Uint8ClampedArray(W * H * 4);
    renderTargetExploration(te, out);
    let painted = 0, skipped = 0;
    for (let i = 0; i < te.state.length; i++) {
      if (te.state[i] !== STATE_CODE.uncertain) continue;
      if (out[i * 4 + 3]) { painted++; expect(Array.from(out.slice(i * 4, i * 4 + 4))).toEqual(STATE_COLORS.uncertain); } else skipped++;
    }
    expect(painted).toBeGreaterThan(0);
    expect(skipped).toBeGreaterThan(0);
  });
  it('状態の一覧の順（優先）: 見つかった > 未確定 > 見つからず', () => {
    expect(EXPLORATION_STATES.indexOf('foundPoint')).toBeGreaterThan(EXPLORATION_STATES.indexOf('uncertain'));
    expect(EXPLORATION_STATES.indexOf('uncertain')).toBeGreaterThan(EXPLORATION_STATES.indexOf('notFound'));
  });
});
