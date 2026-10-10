import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import ExplorationHistoryPanel, { orderHypotheses } from '../src/components/terrain/ExplorationHistoryPanel';
import { closeHypothesisStoreForTest, saveHypothesis } from '../src/exploration/hypothesisStore';
import { NO_HYPOTHESIS_CONDITIONS, type HypothesisSnapshot } from '../src/terrain/hypothesis';
import type { HistoryEntry } from '../src/components/terrain/useExplorationHistory';

// S4b: 登録済みの探索に仮説を付ける・外す（共通の編集契約。端末には保存しない）。探索日と同じ日の仮説を上に

const snap = (id: string, savedAt: string, name = `仮説${id}`): HypothesisSnapshot => ({
  schema: 'icarus.hypothesis/v1', id, name, savedAt, target: { speciesId: 'target-maitake', name: 'マイタケ' }, areaId: 'a',
  data: { terrainVersion: 'v1', terrainCreatedAt: '', sources: [], forest: { present: true, sources: null }, demDerived: { present: true }, evidence: { period: 'all', purposeFilter: 'all', tracks: 0, foundTracks: 0, notFoundTracks: 0, foundPoints: 0, notFoundPoints: 0, latestExploredOn: null, confirmedTrees: 0 } },
  params: { coverageWidthM: 50, pointRadiusM: 50, pxM: 21 }, conditions: NO_HYPOTHESIS_CONDITIONS, conditionText: ['未探索（マイタケ）'], summary: { matchKm2: 1, unexploredKm2: 1, matchCells: 1, unexploredCells: 1 }, app: { build: 'x' },
});
const entry = (hyp: HypothesisSnapshot | null): HistoryEntry => ({
  key: 's:s1', origin: 'server', sessionId: 's1', pendingId: null, exploredOn: '2026-10-05', explorerNames: ['翔大'], purpose: 'maitake',
  targets: [], distanceM: 1200, rawDistanceM: 1200, track: null, rawTrack: null, useRange: null, status: 'registered', updatedAt: 'U1', hypothesis: hyp,
});
const history = (e: HistoryEntry) => ({ pending: [], entries: [e], remoteAsOf: null, remoteError: null, refreshLocal: vi.fn(async () => undefined), refreshRemote: vi.fn(async () => undefined), send: vi.fn(async () => undefined) });
const props = (h: ReturnType<typeof history>) => ({
  history: h as never, staffName: '翔大', show: true, onShowChange: vi.fn(), width: 50 as const, onWidthChange: vi.fn(),
  purposeFilter: 'all' as const, onPurposeFilterChange: vi.fn(), period: 'all' as const, onPeriodChange: vi.fn(), exploredKm2: null, idToken: 'tok', isAdmin: false, onRangePreview: vi.fn(),
});

afterEach(async () => { vi.restoreAllMocks(); await closeHypothesisStoreForTest(); indexedDB.deleteDatabase('icarus-hypotheses'); });

describe('仮説を付ける・外す', () => {
  it('1. 探索日と同じ日に保存した仮説を上に（JST）', () => {
    const list = orderHypotheses([snap('old', '2026-10-06T01:00:00Z'), snap('same', '2026-10-04T22:00:00Z')], '2026-10-05');
    expect(list.map((h) => h.id)).toEqual(['same', 'old']); // 2026-10-04T22:00Z = JST 10/5 07:00
  });

  it('2. 付ける: スナップショットを丸ごと PATCH（expectedUpdatedAt つき）。外す: null', async () => {
    await saveHypothesis(snap('h1', '2026-10-04T22:00:00Z', '舞茸A'));
    const calls: { method: string; url: string; body: Record<string, unknown> }[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (i, init) => {
      calls.push({ method: init?.method ?? 'GET', url: String(i), body: JSON.parse(String(init?.body ?? '{}')) });
      return new Response(JSON.stringify({ outcome: 'applied', updatedAt: 'U2' }));
    });
    const h = history(entry(null));
    const { unmount } = render(<ExplorationHistoryPanel {...props(h)} />);
    fireEvent.change(screen.getByLabelText('仮説を付ける探索'), { target: { value: 's1' } });
    await waitFor(() => expect(screen.getByRole('option', { name: /舞茸A（2026-10-05・この日/ })).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText('付ける仮説'), { target: { value: 'h1' } });
    fireEvent.click(screen.getByRole('button', { name: /この内容で保存/ }));
    expect(await screen.findByText('仮説「舞茸A」を付けました')).toBeInTheDocument();
    expect(calls[0]).toMatchObject({ method: 'PATCH', body: { expectedUpdatedAt: 'U1', changes: { hypothesis: { schema: 'icarus.hypothesis/v1', name: '舞茸A' } } } });
    expect(calls[0].url).toMatch(/\/exploration\/sessions\/s1$/);
    expect(h.refreshRemote).toHaveBeenCalled();
    unmount();

    const h2 = history(entry(snap('h1', '2026-10-04T22:00:00Z', '舞茸A')));
    render(<ExplorationHistoryPanel {...props(h2)} />);
    fireEvent.change(screen.getByLabelText('仮説を付ける探索'), { target: { value: 's1' } });
    expect((screen.getByLabelText('付ける仮説') as HTMLSelectElement).value).toBe('h1');
    fireEvent.change(screen.getByLabelText('付ける仮説'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: /この内容で保存/ }));
    expect(await screen.findByText('仮説を外しました')).toBeInTheDocument();
    expect(calls[1].body).toMatchObject({ changes: { hypothesis: null } });
  });

  it('3. 圏外では保存せず、電波のある所でと伝える', async () => {
    await saveHypothesis(snap('h1', '2026-10-04T22:00:00Z', '舞茸A'));
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'));
    render(<ExplorationHistoryPanel {...props(history(entry(null)))} />);
    fireEvent.change(screen.getByLabelText('仮説を付ける探索'), { target: { value: 's1' } });
    await waitFor(() => expect(screen.getByRole('option', { name: /舞茸A/ })).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText('付ける仮説'), { target: { value: 'h1' } });
    fireEvent.click(screen.getByRole('button', { name: /この内容で保存/ }));
    expect(await screen.findByText(/電波のある所でもう一度/)).toBeInTheDocument();
  });
});
