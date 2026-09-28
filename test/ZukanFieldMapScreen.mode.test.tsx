import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { mockUseAuth } from './testAuth';

// 地形探索モード（Exploration Mode Stage 1）: Field Map に「通常／地形探索」の切り替えを足す。
// 通常モードの表示は変えない。地形探索は遅延読み込みの別部品（ここでは差し替え）

vi.mock('../src/context/AuthContext', () => ({ useAuth: () => mockUseAuth() }));
vi.mock('../src/components/terrain/ExplorationMap', () => ({
  default: ({ entries }: { entries: unknown[] }) => <div data-testid="exploration">地形探索の地図（Field Log {entries.length}件）</div>,
}));
const api = vi.hoisted(() => ({ fetchFieldLogEntries: vi.fn() }));
vi.mock('../src/api/zukanApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/api/zukanApi')>()),
  fetchFieldLogEntries: api.fetchFieldLogEntries,
}));

// この jsdom では localStorage が無いため、メモリ上の置き換えを使う
const memory = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (k: string) => memory.get(k) ?? null,
  setItem: (k: string, v: string) => { memory.set(k, String(v)); },
  removeItem: (k: string) => { memory.delete(k); },
  clear: () => memory.clear(),
  key: (i: number) => [...memory.keys()][i] ?? null,
  get length() { return memory.size; },
});

const { useZukanFieldStore } = await import('../src/store/zukanFieldStore');
const { default: ZukanFieldMapScreen } = await import('../src/screens/ZukanFieldMapScreen');

const go = vi.fn();
const renderScreen = (focusEntry?: Parameters<typeof ZukanFieldMapScreen>[0]['focusEntry']) =>
  render(<ZukanFieldMapScreen go={go} from={{ name: 'home' }} focusEntry={focusEntry} />);

describe('ZukanFieldMapScreen: 通常／地形探索', () => {
  beforeEach(() => {
    localStorage.clear();
    // 通常モードの中身は「読み込み失敗」の表示で確かめる（Leaflet を起動しない）
    api.fetchFieldLogEntries.mockRejectedValue(new Error('テスト用の失敗'));
    useZukanFieldStore.setState({ entries: [], loadState: 'error', errorMessage: 'テスト用の失敗', ensureLoaded: vi.fn(async () => {}) });
  });

  it('1. 既定は通常モード（今までどおりの表示）。地形探索の部品は読み込まない', () => {
    renderScreen();
    expect(screen.getByText('🗺️ フィールドマップ')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '再読み込み' })).toBeInTheDocument();
    expect(screen.queryByTestId('exploration')).toBeNull();
  });

  it('2. ［⛰ 地形探索］で切り替わり、通常モードの表示は出ない。選んだモードは次回も使う', async () => {
    renderScreen();
    fireEvent.click(screen.getByRole('button', { name: '⛰ 地形探索' }));
    expect(await screen.findByTestId('exploration')).toBeInTheDocument();
    expect(screen.getByText('⛰ 地形探索')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '再読み込み' })).toBeNull();
    expect(localStorage.getItem('icarus:field-map-mode')).toBe('terrain');
  });

  it('3. 前回が地形探索なら地形探索で開く。［📍 通常］で戻る', async () => {
    localStorage.setItem('icarus:field-map-mode', 'terrain');
    renderScreen();
    expect(await screen.findByTestId('exploration')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '📍 通常' }));
    expect(screen.queryByTestId('exploration')).toBeNull();
    expect(screen.getByRole('button', { name: '再読み込み' })).toBeInTheDocument();
    expect(localStorage.getItem('icarus:field-map-mode')).toBe('normal');
  });

  it('4. 記録の詳細から地図へ飛んだ時（focusEntry）は通常モードで開く', () => {
    localStorage.setItem('icarus:field-map-mode', 'terrain');
    renderScreen({
      id: 'a', foodName: 'ナラタケ', place: '', date: '2026-09-22', memo: '', photoUrl: '', notionUrl: '', elevation: null,
      kigo: '', lat: 43, lng: 140, recordedAt: '', eventId: 'e', takenAt: '',
    });
    expect(screen.queryByTestId('exploration')).toBeNull();
  });
});
