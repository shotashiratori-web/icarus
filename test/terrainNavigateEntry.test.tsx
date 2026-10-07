import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import EnvironmentSpotDetailSheet from '../src/components/terrain/EnvironmentSpotDetailSheet';
import type { EnvSpeciesItem, EnvironmentSpot } from '../src/environmentSpots/types';
import type { SpotMarker } from '../src/components/terrain/useEnvironmentSpots';

// 「ここへ行く」（Field Navigation v1 PR3）の入口: 環境スポットの詳細から案内を始められる

const SPECIES: EnvSpeciesItem[] = [{ id: 'tree-mizunara', kind: 'tree', name: 'ミズナラ', aliases: [], isUnknown: false, isOther: false, sortOrder: 10, status: 'active' }];
const spot: EnvironmentSpot = {
  id: 'ac1f1e37', title: 'ミズナラ（生木）', envType: 'tree', lifeState: 'alive', treeSpeciesId: 'tree-mizunara', treeSpecies: 'ミズナラ', treeSpeciesText: null,
  dbhCm: null, decayClass: null, lat: 43.10494, lng: 140.86263, locationSource: 'gps', gpsAccuracyM: null, photoMissingReason: null, photoMissingMemo: null,
  photos: [], memo: '', terrain: null, observedAt: '2026-10-06T07:30:48Z', status: 'active', createdByName: '翔大', createdAt: '', updatedAt: 'U1', observations: [],
};
const marker = { key: 's:ac1f1e37', origin: 'server', spotId: 'ac1f1e37', pendingId: null, lat: 43.10494, lng: 140.86263, envType: 'tree', lifeState: 'alive', treeSpeciesId: 'tree-mizunara', label: 'ミズナラ', status: 'registered', error: null, observedAt: null, remote: spot, pending: null } as SpotMarker;

afterEach(() => vi.restoreAllMocks());

describe('ここへ行く: 環境スポットの詳細から', () => {
  it('案内が使える時だけボタンを出し、押すと案内を始める', () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ items: [] })));
    const onNavigate = vi.fn();
    const { unmount } = render(<EnvironmentSpotDetailSheet marker={marker} species={SPECIES} pendingObs={[]} idToken={null} onObserve={vi.fn()} onClose={vi.fn()} onNavigate={onNavigate} />);
    fireEvent.click(screen.getByRole('button', { name: 'ここへ行く' }));
    expect(onNavigate).toHaveBeenCalledTimes(1);
    unmount();
    render(<EnvironmentSpotDetailSheet marker={marker} species={SPECIES} pendingObs={[]} idToken={null} onObserve={vi.fn()} onClose={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'ここへ行く' })).toBeNull();
  });
});
