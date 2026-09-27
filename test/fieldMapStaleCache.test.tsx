import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { signedUrlExpiresAtMs, isSignedUrlExpired, markExpiredImages } from '../src/utils/signedImageUrl';
import FieldDataFreshness from '../src/components/FieldDataFreshness';
import type { FieldLogEntry } from '../src/types/zukan';

// Field Map Stale Cache（2026-09-27）: キャッシュは即時表示・オフライン用に残し、オンラインなら最新へ、
// 取れなければ「いつ時点か」を知らせる。期限切れの署名付き写真URLだけ使わない

const api = vi.hoisted(() => ({ fetchFieldLogEntries: vi.fn() }));
vi.mock('../src/api/zukanApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/api/zukanApi')>()),
  fetchFieldLogEntries: api.fetchFieldLogEntries,
}));
const cache = vi.hoisted(() => ({ loadFieldLogCacheWithMeta: vi.fn(), saveFieldLogCache: vi.fn(), loadFieldLogCache: vi.fn() }));
vi.mock('../src/utils/fieldLogCache', () => cache);

const { useZukanFieldStore } = await import('../src/store/zukanFieldStore');
const { TokenExpiredError } = await import('../src/api/icarusApi');

const NOW = Date.now();
const url = (expSec: number) => `https://icarus-api.example/assets/a/image?variant=thumbnail&expires=${expSec}&signature=x`;
const past = Math.floor((NOW - 3600_000) / 1000);
const future = Math.floor((NOW + 86_400_000) / 1000);

const mk = (eventId: string, foodName: string, exp: number): FieldLogEntry => ({
  id: eventId, foodName, place: 'なな裏山', date: '2026-09-22', memo: '', photoUrl: url(exp), thumbnailUrl: url(exp),
  notionUrl: '', elevation: null, kigo: '', lat: 43, lng: 140, recordedAt: eventId, eventId, takenAt: '',
});

function resetStore() {
  useZukanFieldStore.setState({ entries: [], loadState: 'idle', errorMessage: '', dataAsOf: null, refreshState: 'idle' });
}
const flush = () => new Promise((r) => setTimeout(r, 0));

describe('signedImageUrl', () => {
  it('expires（UNIX秒）を読む。無ければ null（期限なし）', () => {
    expect(signedUrlExpiresAtMs(url(1790607600))).toBe(1790607600_000);
    expect(signedUrlExpiresAtMs('https://res.cloudinary.com/x/y.jpg')).toBeNull();
    expect(signedUrlExpiresAtMs('')).toBeNull();
  });
  it('期限切れ・期限間近（60秒以内）は期限切れ扱い、期限なしは切れない', () => {
    expect(isSignedUrlExpired(url(past), NOW)).toBe(true);
    expect(isSignedUrlExpired(url(Math.floor((NOW + 30_000) / 1000)), NOW)).toBe(true);
    expect(isSignedUrlExpired(url(future), NOW)).toBe(false);
    expect(isSignedUrlExpired('https://res.cloudinary.com/x/y.jpg', NOW)).toBe(false);
  });
  it('記録データは残したまま imageExpired だけ付け直す', () => {
    const out = markExpiredImages([mk('a', 'ひらたけ', past), mk('b', 'ナラタケ', future)], NOW);
    expect(out.map((e) => [e.foodName, e.imageExpired ?? false])).toEqual([['ひらたけ', true], ['ナラタケ', false]]);
  });
});

describe('zukanFieldStore: 古いキャッシュ → 最新へ', () => {
  beforeEach(() => {
    resetStore();
    api.fetchFieldLogEntries.mockReset();
    cache.loadFieldLogCacheWithMeta.mockReset();
    cache.saveFieldLogCache.mockReset();
  });

  it('1. キャッシュを即表示（期限切れ写真は imageExpired、dataAsOf=保存時刻）し、裏の取得で最新に置き換える', async () => {
    const savedAt = NOW - 2 * 86_400_000;
    cache.loadFieldLogCacheWithMeta.mockReturnValue({ entries: [mk('a', 'ひらたけ', past)], savedAt });
    let resolve!: (v: FieldLogEntry[]) => void;
    api.fetchFieldLogEntries.mockReturnValue(new Promise((r) => { resolve = r; }));

    await useZukanFieldStore.getState().ensureLoaded('tok');
    let st = useZukanFieldStore.getState();
    expect(st.loadState).toBe('ready');
    expect(st.entries[0]).toMatchObject({ foodName: 'ひらたけ', imageExpired: true });
    expect(st.dataAsOf).toBe(savedAt);
    expect(st.refreshState).toBe('refreshing');

    resolve([mk('a', 'ならたけ', future), mk('b', 'ナラタケ', future)]);
    await flush();
    st = useZukanFieldStore.getState();
    expect(st.entries.map((e) => e.foodName).sort()).toEqual(['ならたけ', 'ナラタケ']);
    expect(st.entries.every((e) => !e.imageExpired)).toBe(true);
    expect(st.refreshState).toBe('idle');
    expect(st.dataAsOf).toBeGreaterThan(savedAt);
    expect(cache.saveFieldLogCache).toHaveBeenCalled();
  });

  it('2. 認証切れ（401）は authExpired、その他の失敗は failed。どちらもキャッシュ表示は続ける', async () => {
    cache.loadFieldLogCacheWithMeta.mockReturnValue({ entries: [mk('a', 'ひらたけ', future)], savedAt: NOW - 1000 });
    api.fetchFieldLogEntries.mockRejectedValueOnce(new TokenExpiredError('x'));
    await useZukanFieldStore.getState().ensureLoaded('tok');
    await flush();
    expect(useZukanFieldStore.getState()).toMatchObject({ refreshState: 'authExpired', loadState: 'ready' });
    expect(useZukanFieldStore.getState().entries[0].foodName).toBe('ひらたけ');

    resetStore();
    api.fetchFieldLogEntries.mockRejectedValueOnce(new Error('network'));
    await useZukanFieldStore.getState().ensureLoaded('tok');
    await flush();
    expect(useZukanFieldStore.getState()).toMatchObject({ refreshState: 'failed', loadState: 'ready' });
  });

  it('3. 表示中でも古ければ（60秒以上）取り直し、新しければ取り直さない。同時に2本走らせない', async () => {
    useZukanFieldStore.setState({ entries: [mk('a', 'ひらたけ', future)], loadState: 'ready', dataAsOf: NOW - 10_000, refreshState: 'idle' });
    await useZukanFieldStore.getState().ensureLoaded('tok');
    expect(api.fetchFieldLogEntries).not.toHaveBeenCalled();

    useZukanFieldStore.setState({ dataAsOf: NOW - 120_000 });
    api.fetchFieldLogEntries.mockReturnValue(new Promise(() => {}));
    useZukanFieldStore.getState().refreshIfStale('tok');
    useZukanFieldStore.getState().refreshIfStale('tok');
    await useZukanFieldStore.getState().ensureLoaded('tok');
    expect(api.fetchFieldLogEntries).toHaveBeenCalledTimes(1);
  });

  it('4. 取り直せないまま時間が経ったら、期限切れになった写真URLだけ使わない', () => {
    useZukanFieldStore.setState({ entries: [mk('a', 'ならたけ', past)], loadState: 'ready' });
    useZukanFieldStore.getState().recheckImageExpiry();
    expect(useZukanFieldStore.getState().entries[0]).toMatchObject({ foodName: 'ならたけ', imageExpired: true });
  });
});

describe('FieldDataFreshness（いつ時点のデータか）', () => {
  it('最新なら何も出さない、確認中・失敗・認証切れを出し分ける', () => {
    const onRetry = vi.fn();
    const onRelogin = vi.fn();
    const asOf = new Date(2026, 8, 25, 6, 17).getTime();
    const { container, rerender } = render(<FieldDataFreshness refreshState="idle" dataAsOf={asOf} onRetry={onRetry} onRelogin={onRelogin} />);
    expect(container).toBeEmptyDOMElement();
    rerender(<FieldDataFreshness refreshState="refreshing" dataAsOf={asOf} onRetry={onRetry} onRelogin={onRelogin} />);
    expect(screen.getByRole('status')).toHaveTextContent('最新を確認中');
    rerender(<FieldDataFreshness refreshState="failed" dataAsOf={asOf} onRetry={onRetry} onRelogin={onRelogin} />);
    expect(screen.getByRole('status')).toHaveTextContent('最新を取得できませんでした（9/25 06:17 時点の表示）');
    fireEvent.click(screen.getByRole('button', { name: '再試行' }));
    expect(onRetry).toHaveBeenCalled();
    rerender(<FieldDataFreshness refreshState="authExpired" dataAsOf={asOf} onRetry={onRetry} onRelogin={onRelogin} />);
    expect(screen.getByRole('status')).toHaveTextContent('ログインの有効期限が切れています（9/25 06:17 時点の表示）');
    fireEvent.click(screen.getByRole('button', { name: 'ログインし直す' }));
    expect(onRelogin).toHaveBeenCalled();
  });
});
