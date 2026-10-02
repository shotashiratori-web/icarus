import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { submitFieldLogD1 } from '../src/api/fieldLogD1Api';
import EnvironmentSpotRecordSheet from '../src/components/terrain/EnvironmentSpotRecordSheet';
import { nearbySpots, parseTakenAt, selectEnvCaptures, speciesFromName } from '../src/environmentSpots/fieldLogCapture';
import type { EnvSpeciesItem } from '../src/environmentSpots/types';
import type { FieldLogEntry } from '../src/types/zukan';

// Field Log 環境記録 → Environment Spot（icarus_field_log_environment_capture_design.md）:
// 送信で 環境 だけ subjectType を送る／Spot にする候補（未昇格・位置あり）／近くの Spot は人が決める／
// 昇格の画面は Field Log の写真（同じ Asset）・位置・日時・樹種を引き継ぎ、元の記録を関連として送る

const sp = (id: string, kind: 'tree' | 'target', name: string, extra: Partial<EnvSpeciesItem> = {}): EnvSpeciesItem => ({ id, kind, name, aliases: [], isUnknown: false, isOther: false, sortOrder: 0, status: 'active', ...extra });
const SPECIES = [sp('tree-mizunara', 'tree', 'ミズナラ', { aliases: ['水楢'] }), sp('tree-other', 'tree', 'その他', { isOther: true })];
const entry = (over: Partial<FieldLogEntry>): FieldLogEntry => ({
  id: crypto.randomUUID(), foodName: 'ミズナラ', place: '', date: '2026-10-05', memo: '', photoUrl: '', notionUrl: '', elevation: null, kigo: '',
  lat: 43.05, lng: 140.78, recordedAt: '', eventId: crypto.randomUUID(), takenAt: '2026-10-05T09:10:00+09:00', ...over,
});

afterEach(() => vi.restoreAllMocks());

describe('送信（/field/submit-d1）', () => {
  it('1. 環境だけ subjectType を送り、食材では送らない（従来の本文のまま）', async () => {
    const bodies: Record<string, unknown>[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_i, init) => {
      bodies.push(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify({ success: true, eventId: 'e', requestId: 'r', photoUrl: '', duplicate: false }));
    });
    const base = { eventId: 'e', requestId: 'r', date: '2026-10-05', food: 'ミズナラ', place: '', memo: '', photoUrl: '' };
    await submitFieldLogD1({ ...base, subjectType: '環境' }, 'tok');
    await submitFieldLogD1({ ...base, subjectType: '食材' }, 'tok');
    await submitFieldLogD1(base, 'tok');
    expect(bodies[0].subjectType).toBe('環境');
    expect('subjectType' in bodies[1]).toBe(false);
    expect('subjectType' in bodies[2]).toBe(false);
  });
});

describe('Spot にする候補', () => {
  it('2. 環境で・まだ Spot にしていない・位置のある記録だけ、新しい順。食材は出さない', () => {
    const a = entry({ subjectType: '環境', takenAt: '2026-10-05T09:00:00+09:00' });
    const b = entry({ subjectType: '環境', takenAt: '2026-10-05T10:00:00+09:00' });
    const promoted = entry({ subjectType: '環境', environmentSpotId: 's1' });
    const food = entry({ foodName: 'ナラタケ' });
    const local = entry({ subjectType: '環境' });
    const list = selectEnvCaptures([a, b, promoted, food, local], new Set([local.eventId]));
    expect(list.map((e) => e.eventId)).toEqual([b.eventId, a.eventId]);
  });

  it('3. 近くの Spot は 30m 以内を近い順に出すだけ（同じ木とは決めない）', () => {
    const e = { lat: 43.054828, lng: 140.787689 };
    const spots = [{ id: 'A', lat: 43.054828, lng: 140.787689 }, { id: 'B', lat: 43.054353, lng: 140.787689 }, { id: 'C', lat: 43.05496, lng: 140.787689 }];
    const near = nearbySpots(e, spots);
    expect(near.map((x) => x.spot.id)).toEqual(['A', 'C']); // B は約 53m（ミズナラ A/B と同じ距離）で出さない
  });

  it('4. 撮影日時の形式の違い・名前から樹種', () => {
    expect(parseTakenAt('2026-09-30T09:09:25+09:00')).toBe('2026-09-30T00:09:25.000Z');
    expect(parseTakenAt('2026:09:30 09:09:25')).toBe('2026-09-30T00:09:25.000Z');
    expect(parseTakenAt('')).toBeNull();
    expect(speciesFromName('ミズナラ', SPECIES)).toBe('tree-mizunara');
    expect(speciesFromName('水楢', SPECIES)).toBe('tree-mizunara');
    expect(speciesFromName('倒木', SPECIES)).toBeNull();
  });
});

describe('昇格の画面（EnvironmentSpotRecordSheet）', () => {
  it('5. 写真（同じ Asset）・位置・日時・樹種を引き継ぎ、元の Field Log を fieldLogEventId として送る', async () => {
    const onSave = vi.fn(async () => undefined);
    const photos = [{ id: 'p1', name: 'mizunara.jpg', type: 'image/jpeg', data: null, bytes: 0, sha256: '', assetId: 'asset-1' }];
    render(<EnvironmentSpotRecordSheet
      location={{ lat: 43.05, lng: 140.78, source: 'gps', accuracyM: null, fromPhoto: true }}
      species={SPECIES} terrainAt={() => ({ terrainVersion: 'v' })} onSave={onSave} onClose={vi.fn()}
      initialPhotos={photos} observedAt="2026-10-05T00:10:00.000Z"
      fromFieldLog={{ eventId: 'ev-1', name: 'ミズナラ', speciesId: 'tree-mizunara', thumbnailUrl: 'https://example.invalid/t.jpg' }}
    />);
    expect(screen.getByText(/Field Log「ミズナラ」を Spot にする/)).toBeInTheDocument();
    expect(screen.getByAltText('Field Log の写真 1')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /保存/ }));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    const [body, sent] = onSave.mock.calls[0] as unknown as [Record<string, unknown>, typeof photos];
    expect(body).toMatchObject({ fieldLogEventId: 'ev-1', treeSpeciesId: 'tree-mizunara', lifeState: 'alive', lat: 43.05, lng: 140.78, locationSource: 'gps', observedAt: '2026-10-05T00:10:00.000Z' });
    expect(sent[0].assetId).toBe('asset-1');
  });

  it('6. 名前が樹種マスタに無い時は樹種を選ばず、名前をメモに入れておく', () => {
    render(<EnvironmentSpotRecordSheet
      location={{ lat: 43.05, lng: 140.78, source: 'gps', accuracyM: null, fromPhoto: true }}
      species={SPECIES} terrainAt={() => null} onSave={vi.fn()} onClose={vi.fn()}
      fromFieldLog={{ eventId: 'ev-2', name: '大きな倒木', speciesId: null, thumbnailUrl: null }}
    />);
    expect(screen.getByDisplayValue('大きな倒木')).toBeInTheDocument();
  });
});
