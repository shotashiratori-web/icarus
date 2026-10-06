import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import SpotTerrainSection from '../src/components/terrain/SpotTerrainSection';
import type { EnvironmentSpot } from '../src/environmentSpots/types';
import { refetchReason, sameTerrain, terrainRows, terrainState, type TerrainSnapshot } from '../src/terrain/terrainSnapshot';

// 「地形情報を再取得」（PR 3）: 記録時の地形は自動で変えない。人が新旧を見比べて訂正した時だけ、理由つきで履歴に残す。
// 2026-10-06 マイタケ初の正例の宿主ミズナラ Spot（ニセコ表示中に記録して { outside: true }）を余市の値で直す流れ

const AREA: Record<string, string> = { 'yoichi-akaigawa': '余市・赤井川・仁木', 'niseko-yotei': 'ニセコ・羊蹄' };
const areaName = (id: string) => AREA[id] ?? id;
const FAILED: TerrainSnapshot = { terrainVersion: '20261006-9cb22a8f', outside: true };
const YOICHI: TerrainSnapshot = {
  status: 'ok', areaId: 'yoichi-akaigawa', terrainVersion: '20260929-6d7abae2', slopeDeg: 11, sun: 0.87, ridgeM: 167, roadM: 105,
  aspectDeg: 309, aspect: '北西', landform: '谷', streamM: 105, stream: '沢の目安から約110m', twi: 9.7,
  forestStand: { owner: 'k', year: 2018, species: ['カンバ', 'ミズナラ', '他Ｌ'], mizunaraRank: 2 }, vegetation: { name: 'シラカンバ－ミズナラ群落', year: 2022 },
};

const spot = (terrain: TerrainSnapshot | null, extra: Partial<EnvironmentSpot> = {}): EnvironmentSpot => ({
  id: 'ac1f1e37', title: 'ミズナラ（生木）', envType: 'tree', lifeState: 'alive', treeSpeciesId: 'tree-mizunara', treeSpecies: 'ミズナラ', treeSpeciesText: null,
  dbhCm: null, decayClass: null, lat: 43.10494, lng: 140.86263, locationSource: 'gps', gpsAccuracyM: null, photoMissingReason: null, photoMissingMemo: null,
  photos: [], memo: '', terrain, observedAt: '2026-10-06T07:30:48Z', status: 'active', createdByName: '翔大', createdAt: '', updatedAt: 'U1', observations: [], ...extra,
});

function mockFetch(history: unknown[] = []) {
  const calls: { url: string; method: string; body: Record<string, unknown> }[] = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const method = init?.method ?? 'GET';
    calls.push({ url: String(input), method, body: init?.body ? JSON.parse(String(init.body)) : {} });
    if (method === 'GET') return new Response(JSON.stringify({ status: 'success', items: history }));
    return new Response(JSON.stringify({ status: 'success', outcome: 'applied', updatedAt: 'U2' }));
  });
  return calls;
}

afterEach(() => vi.restoreAllMocks());

describe('記録時の地形の状態', () => {
  it('1. ok / not_saved / outside / 旧形式の取得失敗 / なし を区別する', () => {
    expect(terrainState(YOICHI)).toBe('ok');
    expect(terrainState({ terrainVersion: '20260929-6d7abae2', slopeDeg: 18 })).toBe('ok'); // 2026-10-06 より前の正しい記録（status なし）
    expect(terrainState({ status: 'not_saved', areaId: 'yoichi-akaigawa' })).toBe('not_saved');
    expect(terrainState({ status: 'outside', outside: true })).toBe('outside');
    expect(terrainState(FAILED)).toBe('failed_legacy');
    expect(terrainState(null)).toBe('none');
    expect(terrainRows(FAILED, areaName)[0].value).toContain('別の山域を表示していた可能性');
    expect(sameTerrain({ a: 1, b: { c: 2, d: 3 } }, { b: { d: 3, c: 2 }, a: 1 })).toBe(true); // キーの順は問わない
    expect(refetchReason(YOICHI, areaName)).toBe('地形情報を再取得（余市・赤井川・仁木 20260929-6d7abae2）');
  });
});

describe('地形情報を再取得', () => {
  it('2. 取得失敗の記録 → 再取得 → 新旧を見比べて訂正。terrain と理由を送り、自動では送らない', async () => {
    const calls = mockFetch();
    const onDone = vi.fn();
    const terrainAt = vi.fn(async () => YOICHI);
    render(<SpotTerrainSection spot={spot(FAILED)} idToken="tok" terrainAt={terrainAt} areaName={areaName} onDone={onDone} />);
    expect(screen.getByText(/記録時の地形: 取得できていません（記録した時に別の山域を表示していた可能性）/)).toBeInTheDocument();
    expect(calls.filter((c) => c.method === 'PATCH')).toHaveLength(0);

    fireEvent.click(screen.getByRole('button', { name: '地形情報を再取得' }));
    expect(await screen.findByText(/記録時の地形を訂正しますか/)).toBeInTheDocument();
    expect(terrainAt).toHaveBeenCalledWith(43.10494, 140.86263); // Spot の座標で（表示中の山域ではなく）
    expect(screen.getByRole('cell', { name: '余市・赤井川・仁木 20260929-6d7abae2' })).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: 'カンバ・ミズナラ・他Ｌ（ミズナラ 2 位）' })).toBeInTheDocument();
    expect(calls.filter((c) => c.method === 'PATCH')).toHaveLength(0); // 押すまで送らない

    fireEvent.click(screen.getByRole('button', { name: 'この内容で訂正する' }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    const patch = calls.find((c) => c.method === 'PATCH')!;
    expect(patch.url).toMatch(/\/environment-spots\/ac1f1e37$/);
    expect(patch.body).toMatchObject({ expectedUpdatedAt: 'U1', changes: { terrain: YOICHI }, reason: '地形情報を再取得（余市・赤井川・仁木 20260929-6d7abae2）' });
  });

  it('3. 山域を端末に保存していない時は訂正できず、保存を案内する', async () => {
    const calls = mockFetch();
    render(<SpotTerrainSection spot={spot(FAILED)} idToken="tok" terrainAt={async () => ({ status: 'not_saved', areaId: 'yoichi-akaigawa', areaName: '余市・赤井川・仁木' })} areaName={areaName} onDone={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: '地形情報を再取得' }));
    expect(await screen.findByText(/余市・赤井川・仁木を端末に保存していないため、再取得できません/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'この内容で訂正する' })).toBeNull();
    expect(calls.filter((c) => c.method === 'PATCH')).toHaveLength(0);
  });

  it('4. 再取得しても同じなら、訂正の必要はないと出して送らない', async () => {
    const calls = mockFetch();
    render(<SpotTerrainSection spot={spot(YOICHI)} idToken="tok" terrainAt={async () => ({ ...YOICHI })} areaName={areaName} onDone={vi.fn()} />);
    expect(screen.getByText(/記録時の地形: 方位 北西・谷・傾斜 11°・沢の目安から約110m（余市・赤井川・仁木 20260929-6d7abae2）/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '地形情報を再取得' }));
    expect(await screen.findByText(/記録されている地形と同じです/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'この内容で訂正する' })).toBeNull();
    expect(calls.filter((c) => c.method === 'PATCH')).toHaveLength(0);
  });

  it('5. 地形の訂正履歴を表示する（変更前 → 変更後・理由）', async () => {
    mockFetch([{ id: 'h1', entityType: 'spot', entityId: 'ac1f1e37', editedAt: '2026-10-06T13:00:00Z', editedByName: '翔大', reason: '地形情報を再取得（余市・赤井川・仁木 20260929-6d7abae2）', changes: [{ field: 'terrain', old: FAILED, new: YOICHI }] }]);
    render(<SpotTerrainSection spot={spot(YOICHI, { updatedAt: 'U2' })} idToken="tok" terrainAt={async () => YOICHI} areaName={areaName} onDone={vi.fn()} />);
    expect(await screen.findByText(/地形の訂正 .*翔大: 取得できていません（記録した時に別の山域を表示していた可能性） → 余市・赤井川・仁木 20260929-6d7abae2/)).toBeInTheDocument();
  });

  it('6. 再取得の手段が無い所（terrainAt なし）・無効化済みではボタンを出さない', () => {
    mockFetch();
    const { unmount } = render(<SpotTerrainSection spot={spot(FAILED)} idToken="tok" areaName={areaName} onDone={vi.fn()} />);
    expect(screen.queryByRole('button', { name: '地形情報を再取得' })).toBeNull();
    unmount();
    render(<SpotTerrainSection spot={spot(FAILED, { status: 'archived' })} idToken="tok" terrainAt={async () => YOICHI} areaName={areaName} onDone={vi.fn()} />);
    expect(screen.queryByRole('button', { name: '地形情報を再取得' })).toBeNull();
  });
});
