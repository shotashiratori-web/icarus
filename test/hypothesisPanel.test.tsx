import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import HypothesisPanel from '../src/components/terrain/HypothesisPanel';
import { closeHypothesisStoreForTest, deleteHypothesis, listHypotheses, saveHypothesis } from '../src/exploration/hypothesisStore';
import { NO_HYPOTHESIS_CONDITIONS, type HypothesisSnapshot } from '../src/terrain/hypothesis';
import type { EnvSpeciesItem } from '../src/environmentSpots/types';

// S4a パネル: 対象の既定は未選択・森林計画と植生図は別の項目・仮説は端末に保存（削除は 2 段階）

const sp = (id: string, kind: 'tree' | 'target', name: string): EnvSpeciesItem => ({ id, kind, name, aliases: [], isUnknown: false, isOther: false, sortOrder: 0, status: 'active' });
const snap = (id: string, savedAt: string, version = 'v1'): HypothesisSnapshot => ({
  schema: 'icarus.hypothesis/v1', id, name: `仮説${id}`, savedAt, target: null, areaId: 'a',
  data: { terrainVersion: version, terrainCreatedAt: '', sources: [], forest: { present: true, sources: null }, demDerived: { present: true }, evidence: { period: 'all', purposeFilter: 'all', tracks: 0, foundTracks: 0, notFoundTracks: 0, foundPoints: 0, notFoundPoints: 0, latestExploredOn: null, confirmedTrees: 0 } },
  params: { coverageWidthM: 50, pointRadiusM: 50, pxM: 21 }, conditions: NO_HYPOTHESIS_CONDITIONS, conditionText: [], summary: { matchKm2: 1.2, unexploredKm2: 1, matchCells: 1, unexploredCells: 1 }, app: { build: 'x' },
});

function props(over: Partial<React.ComponentProps<typeof HypothesisPanel>> = {}): React.ComponentProps<typeof HypothesisPanel> {
  return {
    targets: [sp('target-maitake', 'target', 'マイタケ')], targetId: null, onTarget: vi.fn(), hyp: NO_HYPOTHESIS_CONDITIONS, onHyp: vi.fn(),
    terrainUse: { candidate: false, dem: false }, onTerrainUse: vi.fn(), demAvailable: true, demSummary: null, candidateSummary: '傾斜 25° 以上',
    communities: ['ミズナラ群落'], forestAvailable: true, forestYears: { forestPlan: '国有林 2018', vegetation: '2021〜2022' },
    trees: [sp('tree-mizunara', 'tree', 'ミズナラ')], treeCounts: { 'tree-mizunara': 2 }, stateAreas: null,
    showTargetLayer: true, onShowTargetLayer: vi.fn(), showMatch: true, onShowMatch: vi.fn(), conditionText: [], match: null, missing: [],
    saved: [], suggestedName: '案', onSave: vi.fn(async () => undefined), onLoad: vi.fn(), onDelete: vi.fn(async () => undefined), terrainVersion: 'v1', pointRadiusM: 50,
    ...over,
  };
}

afterEach(async () => { vi.restoreAllMocks(); await closeHypothesisStoreForTest(); });

describe('HypothesisPanel', () => {
  it('1. 対象の既定は未選択。選ぶと onTarget', () => {
    const p = props();
    render(<HypothesisPanel {...p} />);
    const sel = screen.getByLabelText('探す対象') as HTMLSelectElement;
    expect(sel.value).toBe('');
    fireEvent.change(sel, { target: { value: 'target-maitake' } });
    expect(p.onTarget).toHaveBeenCalledWith('target-maitake');
  });

  it('2. 森林計画のミズナラ 1 位と植生図のミズナラ系群落は別の項目として送る', () => {
    const p = props();
    render(<HypothesisPanel {...p} />);
    expect(screen.getByText(/ミズナラ系群落（ミズナラそのものではありません）/)).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('1位'));
    expect(p.onHyp).toHaveBeenLastCalledWith({ ...NO_HYPOTHESIS_CONDITIONS, forestPlan: { mizunaraRanks: [1] } });
    fireEvent.click(screen.getByLabelText('ミズナラ群落'));
    expect(p.onHyp).toHaveBeenLastCalledWith({ ...NO_HYPOTHESIS_CONDITIONS, vegetation: { communities: ['ミズナラ群落'] } });
  });

  it('3. 条件があれば文と面積を出し、名前が空なら案の名前で保存する', async () => {
    const p = props({ conditionText: ['森林計画（国有林 2018）ミズナラ 1位', '未探索（マイタケ）'], match: { matchKm2: 1.42, unexploredKm2: 1.1 } });
    render(<HypothesisPanel {...p} />);
    expect(screen.getByTestId('hypothesis-text').textContent).toBe('森林計画（国有林 2018）ミズナラ 1位 かつ 未探索（マイタケ）');
    expect(screen.getByText(/条件をすべて満たす範囲 1.4 km²/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '仮説として保存' }));
    await waitFor(() => expect(p.onSave).toHaveBeenCalledWith('案'));
    expect(await screen.findByText('この端末に保存しました')).toBeInTheDocument();
  });

  it('4. 保存した仮説: 版が違えば知らせる。削除は 2 回押す', () => {
    const p = props({ saved: [snap('1', '2026-10-01T00:00:00Z', 'v0')] });
    render(<HypothesisPanel {...p} />);
    expect(screen.getByText(/地形データの版が今と違います/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '削除' }));
    expect(p.onDelete).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '本当に削除' }));
    expect(p.onDelete).toHaveBeenCalledWith('1');
  });
});

describe('仮説の端末保存', () => {
  it('5. 新しい順に並び、消せる', async () => {
    await saveHypothesis(snap('a', '2026-10-01T00:00:00Z'));
    await saveHypothesis(snap('b', '2026-10-02T00:00:00Z'));
    expect((await listHypotheses()).map((h) => h.id)).toEqual(['b', 'a']);
    await deleteHypothesis('b');
    expect((await listHypotheses()).map((h) => h.id)).toEqual(['a']);
  });
});
