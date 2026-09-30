import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { closeSpotStoreForTest, updatePendingSpot } from '../src/environmentSpots/store';

// 環境スポットの送信結果を画面に出す: 保存 → 送信中 → 「送信しました」／「未送信です」

const sent = vi.hoisted(() => ({ ok: true }));
vi.mock('../src/api/environmentSpotsApi', async (orig) => ({
  ...(await orig<typeof import('../src/api/environmentSpotsApi')>()),
  fetchEnvSpecies: vi.fn(async () => [{ id: 'tree-mizunara', kind: 'tree', name: 'ミズナラ', aliases: [], isUnknown: false, isOther: false, sortOrder: 10, status: 'active' }]),
  fetchEnvironmentSpots: vi.fn(async () => []),
}));
vi.mock('../src/environmentSpots/submit', () => ({
  resumeSpotPending: vi.fn(async () => 0),
  submitObservation: vi.fn(async () => false),
  submitSpot: vi.fn(async (id: string) => {
    if (sent.ok) await updatePendingSpot(id, { stage: 'registered', spotId: 'spot-1' });
    return sent.ok;
  }),
}));

const { useEnvironmentSpots } = await import('../src/components/terrain/useEnvironmentSpots');
const body = { envType: 'tree' as const, lifeState: 'alive' as const, treeSpeciesId: 'tree-mizunara', lat: 43.05, lng: 140.78, locationSource: 'map' as const, gpsAccuracyM: null, photoMissingReason: 'dark' as const, memo: '', observedAt: '2026-09-30T00:14:15Z' };

describe('送信結果の表示', () => {
  beforeEach(async () => {
    await closeSpotStoreForTest();
    await new Promise<void>((r) => { const q = indexedDB.deleteDatabase('icarus-environment-spots'); q.onsuccess = q.onerror = q.onblocked = () => r(); });
  });

  it('1. 送れたら「送信しました（環境スポット: ミズナラ）」', async () => {
    sent.ok = true;
    const { result } = renderHook(() => useEnvironmentSpots('tok', null));
    await waitFor(() => expect(result.current.species.length).toBe(1));
    await act(async () => { await result.current.record(body, []); });
    await waitFor(() => expect(result.current.notice?.text).toBe('送信しました（環境スポット: ミズナラ）'));
    expect(result.current.notice?.kind).toBe('ok');
  });

  it('2. 送れなければ「未送信です。電波のある所で自動的に送信します」', async () => {
    sent.ok = false;
    const { result } = renderHook(() => useEnvironmentSpots('tok', null));
    await waitFor(() => expect(result.current.species.length).toBe(1));
    await act(async () => { await result.current.record(body, []); });
    await waitFor(() => expect(result.current.notice?.kind).toBe('warn'));
    expect(result.current.notice?.text).toContain('未送信です');
  });
});
