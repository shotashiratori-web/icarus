import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { clipTrack, detectVehicleIntervals, excludedParts, hhmm, trackDistanceM, walkingCandidate, type TimedTrack } from '../src/exploration/trackRange';
import ExplorationRangeEditor from '../src/components/terrain/ExplorationRangeEditor';
import type { HistoryEntry } from '../src/components/terrain/useExplorationHistory';

// Track Range v1（icarus_exploration_track_range_v1_design.md）: 速度で車の区間の候補を出すだけ。確定は管理者が理由を書いて行う

const T0 = Date.parse('2026-10-06T05:54:00Z') / 1000; // JST 14:54
const M_PER_DEG_LAT = 111_195;
// 北へ speed(m/s) で dur 秒、step 秒ごとに点を打つ
function leg(start: { lat: number; t: number }, speed: number, dur: number, step = 10): [number, number, number][] {
  const pts: [number, number, number][] = [];
  for (let s = step; s <= dur; s += step) pts.push([start.lat + (speed * s) / M_PER_DEG_LAT, 140.9, start.t + s]);
  return pts;
}
function build(legs: [number, number][]): TimedTrack {
  const pts: [number, number, number | null][] = [[43.1, 140.9, T0]];
  for (const [speed, dur] of legs) {
    const last = pts[pts.length - 1];
    pts.push(...leg({ lat: last[0], t: last[2]! }, speed, dur));
  }
  return [pts];
}
const WALK = 1.0; // 3.6km/h
const CAR = 11; // 40km/h
const SLOW_FOREST_CAR = 14 / 3.6; // 林道を車でゆっくり（9/26 の 14km/h）

describe('車の区間の判定（候補を出すだけ）', () => {
  it('歩きだけ → 車の区間なし・候補なし（全区間のまま）', () => {
    const tr = build([[WALK, 3600], [0, 600], [WALK * 1.5, 1800]]);
    expect(detectVehicleIntervals(tr)).toEqual([]);
    expect(walkingCandidate(tr).candidate).toBeNull();
  });

  it('終わりに車（10/06 の形）→ 歩きの区間が候補', () => {
    const tr = build([[WALK, 2 * 3600 + 15 * 60], [CAR, 45 * 60]]);
    const r = walkingCandidate(tr);
    expect(r.vehicles).toHaveLength(1);
    expect(hhmm(r.candidate!.fromS)).toBe('14:54');
    expect(Math.abs(r.candidate!.toS - (T0 + 8100))).toBeLessThanOrEqual(40);
  });

  it('始まりに車（9/21 の形）→ 車の後の歩きが候補', () => {
    const tr = build([[CAR, 20 * 60], [WALK, 90 * 60]]);
    const r = walkingCandidate(tr);
    expect(Math.abs(r.candidate!.fromS - (T0 + 1200))).toBeLessThanOrEqual(40);
    expect(r.candidate!.toS).toBe(T0 + 1200 + 5400);
  });

  it('林道を 14km/h でゆっくり走る区間も拾う。短い速歩き（2 分未満）は拾わない', () => {
    expect(detectVehicleIntervals(build([[WALK, 1800], [SLOW_FOREST_CAR, 300], [WALK, 1800]]))).toHaveLength(1);
    expect(detectVehicleIntervals(build([[WALK, 1800], [CAR, 60], [WALK, 1800]]))).toEqual([]);
  });
});

describe('使う区間で切る', () => {
  const tr = build([[WALK, 3600], [CAR, 1800]]);
  const range = { fromS: T0, toS: T0 + 3600 };
  it('区間の外の点を落とす。null は全区間', () => {
    expect(clipTrack(tr, null)[0]).toHaveLength(tr[0].length);
    const used = clipTrack(tr, range);
    expect(trackDistanceM(used)).toBeCloseTo(3600, -1);
    expect(trackDistanceM(clipTrack(tr, null))).toBeCloseTo(3600 + CAR * 1800, -2);
  });
  it('外す区間は境目の点でつながる', () => {
    const ex = excludedParts(tr, range);
    expect(ex).toHaveLength(1);
    const used = clipTrack(tr, range)[0];
    expect(ex[0][0]).toEqual(used[used.length - 1]);
  });
});

describe('区間の確定（管理者・理由必須・履歴）', () => {
  afterEach(() => vi.restoreAllMocks());
  const rawTrack = build([[WALK, 2 * 3600 + 15 * 60], [CAR, 45 * 60]]);
  const entry: HistoryEntry = {
    key: 's:s1', origin: 'server', sessionId: 's1', pendingId: null, exploredOn: '2026-10-06', explorerNames: ['翔大'], purpose: 'maitake',
    targets: [], distanceM: 38000, rawDistanceM: 38000, track: clipTrack(rawTrack, null), rawTrack, useRange: null, status: 'registered', updatedAt: 'U1', hypothesis: null,
  };

  it('候補で青／灰色をプレビュー → 理由なしでは送らない → 理由つきで PATCH。履歴を 変更前→変更後・実施者・理由 で出す', async () => {
    const calls: { method: string; url: string; body: Record<string, unknown> }[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (i, init) => {
      const method = init?.method ?? 'GET';
      calls.push({ method, url: String(i), body: JSON.parse(String(init?.body ?? '{}')) });
      if (String(i).endsWith('/history')) {
        return new Response(JSON.stringify({ items: [{ id: 'e1', editedAt: '2026-10-10T05:00:00Z', editedByName: '翔大', reason: '下山後の車移動を除外', changes: [{ field: 'useRange', old: 'null', new: JSON.stringify({ fromS: T0, toS: T0 + 8100 }) }] }] }));
      }
      return new Response(JSON.stringify({ outcome: 'applied', updatedAt: 'U2' }));
    });
    const onPreview = vi.fn();
    const onSaved = vi.fn(async () => undefined);
    render(<ExplorationRangeEditor entries={[entry]} idToken="tok" onPreview={onPreview} onSaved={onSaved} />);
    expect(screen.getByRole('option', { name: /車の区間あり/ })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('区間を決める探索'), { target: { value: 's:s1' } });

    const preview = onPreview.mock.calls.at(-1)![0] as { key: string; range: { fromS: number; toS: number } };
    expect(preview.key).toBe('s:s1');
    expect(preview.range.fromS).toBe(T0);
    expect(Math.abs(preview.range.toS - (T0 + 8100))).toBeLessThanOrEqual(40);

    fireEvent.click(screen.getByRole('button', { name: /この区間で確定/ }));
    expect(await screen.findByText(/理由を入力してください/)).toBeInTheDocument();
    expect(calls.filter((c) => c.method === 'PATCH')).toHaveLength(0);

    fireEvent.change(screen.getByLabelText('区間を変える理由'), { target: { value: '下山後の車移動を除外' } });
    fireEvent.click(screen.getByRole('button', { name: /この区間で確定/ }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    const patch = calls.find((c) => c.method === 'PATCH')!;
    expect(patch.url).toMatch(/\/exploration\/sessions\/s1$/);
    expect(patch.body).toMatchObject({ expectedUpdatedAt: 'U1', changes: { useRange: preview.range }, reason: '下山後の車移動を除外' });

    expect(await screen.findByText(/全区間 14:54–17:54 → 探索区間 14:54–17:09/)).toBeInTheDocument();
    expect(screen.getByText(/理由: 下山後の車移動を除外/)).toBeInTheDocument();
  });

  it('確定済みなら「全体を使う」で null を送る（理由必須）', async () => {
    const calls: Record<string, unknown>[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (i, init) => {
      if (init?.method === 'PATCH') calls.push(JSON.parse(String(init.body)));
      return new Response(JSON.stringify(String(i).endsWith('/history') ? { items: [] } : { outcome: 'applied' }));
    });
    render(<ExplorationRangeEditor entries={[{ ...entry, useRange: { fromS: T0, toS: T0 + 8100 } }]} idToken="tok" onPreview={vi.fn()} onSaved={vi.fn(async () => undefined)} />);
    fireEvent.change(screen.getByLabelText('区間を決める探索'), { target: { value: 's:s1' } });
    fireEvent.change(screen.getByLabelText('区間を変える理由'), { target: { value: '全区間に戻す' } });
    fireEvent.click(screen.getByRole('button', { name: /全体を使う/ }));
    expect(await screen.findByText('全区間を使うように戻しました')).toBeInTheDocument();
    expect(calls[0]).toMatchObject({ changes: { useRange: null }, reason: '全区間に戻す' });
  });
});
