import 'fake-indexeddb/auto';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { EnvSpeciesItem } from '../src/environmentSpots/types';

// 記録画面で「撮った写真を選ぶ」: 選択欄を空に戻しても撮影日時・位置を読む（空になった FileList を読んでいたバグ）。
// 写真に位置があれば写真の位置、無ければ「ファイル」から選ぶ案内と古い写真×現在地の警告

const meta = vi.hoisted(() => ({ value: { lat: null as number | null, lng: null as number | null, accuracyM: null as number | null, takenAt: '2026-09-30T00:14:16.000Z' as string | null } }));
vi.mock('../src/environmentSpots/photoMeta', () => ({
  readPhotoMeta: vi.fn(async () => meta.value),
  speciesUsage: () => ({}),
  countSpeciesUse: () => undefined,
}));
const { default: EnvironmentSpotRecordSheet } = await import('../src/components/terrain/EnvironmentSpotRecordSheet');

const SPECIES: EnvSpeciesItem[] = [{ id: 'tree-mizunara', kind: 'tree', name: 'ミズナラ', aliases: [], isUnknown: false, isOther: false, sortOrder: 10, status: 'active' }];
const jpeg = () => new File([new Uint8Array([0xff, 0xd8, 0xff, 1])], 'IMG_3195.JPG', { type: 'image/jpeg' });
function pick() {
  const input = screen.getByText('撮った写真を選ぶ').querySelector('input') as HTMLInputElement;
  fireEvent.change(input, { target: { files: [jpeg()] } }); // 画面は読み取り後すぐ選択欄を空に戻す
}

describe('撮った写真を選ぶ', () => {
  it('1. 位置の無い古い写真: 撮影日時を記録日時にし、現在地のままなら警告。「ファイル」から選ぶ案内', async () => {
    meta.value = { lat: null, lng: null, accuracyM: 4.7, takenAt: '2026-09-30T00:14:16.000Z' };
    render(<EnvironmentSpotRecordSheet location={{ lat: 43.19135, lng: 140.79865, source: 'gps', accuracyM: 3 }} species={SPECIES} terrainAt={() => null} onSave={vi.fn(async () => undefined)} onClose={vi.fn()} />);
    pick();
    expect(await screen.findByText('（写真の撮影日時）', { exact: false })).toBeInTheDocument();
    expect(screen.getByText('木の場所ではない可能性があります', { exact: false })).toBeInTheDocument();
    expect(screen.getByText('“ファイル”に保存', { exact: false })).toBeInTheDocument();
  });

  it('2. 位置の残っている写真（「ファイル」から選んだ元の写真）: 現在地ではなく写真の撮影時の位置を使う', async () => {
    meta.value = { lat: 43.054353, lng: 140.787705, accuracyM: 4.7, takenAt: '2026-09-30T00:14:16.000Z' };
    const onSave = vi.fn(async (..._a: unknown[]) => undefined);
    render(<EnvironmentSpotRecordSheet location={{ lat: 43.19135, lng: 140.79865, source: 'gps', accuracyM: 3 }} species={SPECIES} terrainAt={() => null} onSave={onSave} onClose={vi.fn()} />);
    pick();
    expect(await screen.findByText('写真の撮影時の GPS', { exact: false })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '生木' }));
    fireEvent.click(screen.getByRole('button', { name: 'ミズナラ' }));
    fireEvent.click(screen.getByRole('button', { name: '端末に保存して送信' }));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave.mock.calls[0][0]).toMatchObject({ lat: 43.054353, lng: 140.787705, locationSource: 'gps', gpsAccuracyM: 4.7, observedAt: '2026-09-30T00:14:16.000Z' });
  });
});
