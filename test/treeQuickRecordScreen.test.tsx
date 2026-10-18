import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

// 木を撮ってすぐ記録（icarus_tree_quick_record_v1_design.md）: 撮影 → 太さ → 特徴 → 保存が、
// Field Log（環境・D1）の送信の中身として正しく届くか。送信そのもの（submitWithFallback）は mock

const { submitWithFallback, fetchGps } = vi.hoisted(() => ({ submitWithFallback: vi.fn(), fetchGps: vi.fn() }));
vi.mock('../src/submission/orchestrator', () => ({ submitWithFallback }));
vi.mock('../src/config', async (orig) => ({ ...(await orig<object>()), PHOTO_ASSET_R2_ENABLED: false }));
vi.mock('../src/api/icarusApi', async (orig) => ({
  ...(await orig<object>()),
  resizeToJpeg: vi.fn(async () => 'QUJD'),
  extractExifDate: vi.fn(async () => ({ date: '2026-10-19', takenAt: '2026-10-19T01:02:03.000Z' })),
  fetchGps,
}));

import TreeQuickRecord from '../src/components/terrain/TreeQuickRecord';

const shoot = () => {
  const input = document.querySelector('input[type="file"]') as HTMLInputElement;
  fireEvent.change(input, { target: { files: [new File(['x'], 'tree.jpg', { type: 'image/jpeg' })] } });
};

describe('木を撮ってすぐ記録', () => {
  beforeEach(() => {
    submitWithFallback.mockReset().mockResolvedValue({ ok: true });
    fetchGps.mockReset().mockResolvedValue({ lat: 43.1, lng: 140.8, accuracy: 7.6 });
    try { globalThis.localStorage?.clear?.(); } catch { /* 環境に無い時は何もしない */ }
    globalThis.URL.createObjectURL = vi.fn(() => 'blob:x');
    globalThis.URL.revokeObjectURL = vi.fn();
  });

  it('太さと特徴がメモの形で、環境の Field Log として送られる', async () => {
    render(<TreeQuickRecord idToken="t" livePos={null} onTokenExpired={() => {}} buttonClassName="b" />);
    shoot();
    fireEvent.change(screen.getByLabelText('太さ（cm）'), { target: { value: '80' } });
    fireEvent.click(screen.getByRole('button', { name: '林縁' }));
    fireEvent.click(screen.getByRole('button', { name: '株立ち' }));
    fireEvent.click(screen.getByRole('button', { name: '保存して閉じる' }));
    await waitFor(() => expect(submitWithFallback).toHaveBeenCalledTimes(1));
    const { entity, payload } = submitWithFallback.mock.calls[0][0];
    expect(entity).toBe('fieldLogD1');
    expect(payload).toMatchObject({
      food: 'ミズナラ', memo: '太さ80cm・株立ち・林縁・位置±8m', subjectType: '環境', largeCategory: '植物',
      latitude: 43.1, longitude: 140.8, date: '2026-10-19', takenAt: '2026-10-19T01:02:03.000Z', hasPhoto: true, photoBase64: 'QUJD', useR2Asset: false,
    });
    expect(await screen.findByRole('status')).toHaveTextContent('木 1 本（送信 1）');
  });

  it('現在地を追っていれば、その位置を待たずに使う。次の木は前の樹種から', async () => {
    render(<TreeQuickRecord idToken="t" livePos={{ lat: 43.2, lng: 140.7, accuracy: 3 }} onTokenExpired={() => {}} buttonClassName="b" />);
    shoot();
    fireEvent.click(screen.getByRole('button', { name: 'カツラ' }));
    fireEvent.click(screen.getByRole('button', { name: '保存して閉じる' }));
    await waitFor(() => expect(submitWithFallback).toHaveBeenCalledTimes(1));
    expect(fetchGps).not.toHaveBeenCalled();
    expect(submitWithFallback.mock.calls[0][0].payload).toMatchObject({ food: 'カツラ', memo: '位置±3m', latitude: 43.2 });
    shoot();
    expect(screen.getByRole('button', { name: 'カツラ' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('位置が取れない時は 位置なし で保存して知らせる。送れなければ保留の数', async () => {
    fetchGps.mockResolvedValue(null);
    submitWithFallback.mockResolvedValue({ ok: false, item: { lastError: null } });
    render(<TreeQuickRecord idToken="t" livePos={null} onTokenExpired={() => {}} buttonClassName="b" />);
    shoot();
    fireEvent.click(screen.getByRole('button', { name: '保存して閉じる' }));
    await waitFor(() => expect(submitWithFallback).toHaveBeenCalledTimes(1));
    expect(submitWithFallback.mock.calls[0][0].payload).toMatchObject({ memo: '位置なし', latitude: undefined });
    const st = await screen.findByRole('status');
    await waitFor(() => expect(st).toHaveTextContent('保留 1'));
    expect(st).toHaveTextContent('位置が取れなかった木があります');
  });

  it('やめると送らない', async () => {
    render(<TreeQuickRecord idToken="t" livePos={null} onTokenExpired={() => {}} buttonClassName="b" />);
    shoot();
    fireEvent.click(screen.getByRole('button', { name: 'やめる' }));
    await new Promise((r) => setTimeout(r, 20));
    expect(submitWithFallback).not.toHaveBeenCalled();
  });
});
