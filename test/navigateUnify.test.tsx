import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import EnvironmentSpotDetailSheet from '../src/components/terrain/EnvironmentSpotDetailSheet';
import ZukanFieldDetailScreen from '../src/screens/ZukanFieldDetailScreen';
import { mockUseAuth } from './testAuth';
import type { EnvSpeciesItem, EnvironmentSpot } from '../src/environmentSpots/types';
import type { SpotMarker } from '../src/components/terrain/useEnvironmentSpots';
import type { FieldLogEntry } from '../src/types/zukan';

// 案内の導線を Icarus に統一（Field Navigation v1 本番前調整 ④、icarus_field_navigation_v1_design.md §13）
// 主 = 「ここへ行く」（Icarus の案内）、二次 = 「外部地図で開く」（Google マップ）。どこから場所を見つけても同じ案内へ

vi.mock('../src/context/AuthContext', () => ({ useAuth: () => mockUseAuth() }));
const api = vi.hoisted(() => ({ fetchFieldEntryDetail: vi.fn(), fetchFieldEntryHistory: vi.fn() }));
vi.mock('../src/api/fieldEntryEditApi', async (importOriginal) => ({ ...(await importOriginal<typeof import('../src/api/fieldEntryEditApi')>()), ...api }));

const SPECIES: EnvSpeciesItem[] = [{ id: 'tree-mizunara', kind: 'tree', name: 'ミズナラ', aliases: [], isUnknown: false, isOther: false, sortOrder: 10, status: 'active' }];
const spot: EnvironmentSpot = {
  id: 'ac1f1e37', title: 'ミズナラ（生木）', envType: 'tree', lifeState: 'alive', treeSpeciesId: 'tree-mizunara', treeSpecies: 'ミズナラ', treeSpeciesText: null,
  dbhCm: null, decayClass: null, lat: 43.10494, lng: 140.86263, locationSource: 'gps', gpsAccuracyM: null, photoMissingReason: null, photoMissingMemo: null,
  photos: [], memo: '', terrain: null, observedAt: '2026-10-06T07:30:48Z', status: 'active', createdByName: 't', createdAt: '', updatedAt: 'U1', observations: [],
};
const marker = { key: 's:ac1f1e37', origin: 'server', spotId: 'ac1f1e37', pendingId: null, lat: 43.10494, lng: 140.86263, envType: 'tree', lifeState: 'alive', treeSpeciesId: 'tree-mizunara', label: 'ミズナラ', status: 'registered', error: null, observedAt: null, remote: spot, pending: null } as SpotMarker;

const entry: FieldLogEntry = {
  id: 'x', foodName: '本舞茸', place: '赤井川', date: '2026-10-06', memo: '', photoUrl: '', notionUrl: '',
  elevation: null, kigo: '', lat: 43.10494, lng: 140.86263, recordedAt: '', eventId: 'ev-1', takenAt: '',
};

beforeEach(() => {
  vi.restoreAllMocks();
  api.fetchFieldEntryDetail.mockReset().mockResolvedValue(null);
  api.fetchFieldEntryHistory.mockReset().mockResolvedValue([]);
});

describe('案内の導線', () => {
  it('1. 環境スポット: 主は「ここへ行く」、Google マップは「外部地図で開く」', () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ items: [] })));
    render(<EnvironmentSpotDetailSheet marker={marker} species={SPECIES} pendingObs={[]} idToken={null} onObserve={vi.fn()} onClose={vi.fn()} onNavigate={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'ここへ行く' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '外部地図で開く' }).getAttribute('href')).toMatch(/^https:\/\/www\.google\.com\/maps\/dir\//);
  });

  it('2. 図鑑の Field Log 詳細: 「🧭 ここへ行く」で地形探索を開いて案内を始める。Google は二次操作', () => {
    const go = vi.fn();
    render(<ZukanFieldDetailScreen go={go} entry={entry} from={{ name: 'zukanTop' } as never} />);
    expect(screen.queryByText(/経路案内/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '🧭 ここへ行く' }));
    expect(go).toHaveBeenCalledWith(expect.objectContaining({
      name: 'zukanFieldMap',
      navigateTo: { kind: 'fieldlog', name: '本舞茸', lat: 43.10494, lng: 140.86263 },
    }));
    expect(screen.getByRole('link', { name: '外部地図で開く' }).getAttribute('href')).toMatch(/google\.com\/maps\/dir/);
  });
});
