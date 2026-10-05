import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import { mockUseAuth } from './testAuth';

// 複数エリア（山域）: 地図を開いた時にどの山域を出すか（設計 icarus_terrain_multi_area_ui_design.md §2-4）。
// Gate: 余市だけ保存している端末は、全体図を一度も出さずに今までどおり余市を直接開く。新規・未保存の端末は全体図から始まる

vi.mock('../src/context/AuthContext', () => ({ useAuth: () => mockUseAuth() }));
// 地図（Leaflet）は描かない。子だけ描く
vi.mock('react-leaflet', () => {
  const Pass = ({ children }: { children?: unknown }) => <>{children as never}</>;
  const Null = () => null;
  return {
    MapContainer: Pass, TileLayer: Null, ImageOverlay: Null, Rectangle: Pass, Tooltip: Pass, CircleMarker: Null, Circle: Null,
    Marker: Null, Polyline: Null, Popup: Pass, useMap: () => ({}), useMapEvents: () => ({}),
  };
});
// 格子の読み取り（canvas）は jsdom で動かないので、読めない扱いにする（地図の中身はこのテストの対象外）
vi.mock('../src/terrain/decode', async (orig) => ({
  ...(await orig<typeof import('../src/terrain/decode')>()),
  decodeGrid: vi.fn(async () => { throw new Error('テストでは格子を読まない'); }),
}));
vi.mock('../src/components/terrain/useExplorationHistory', () => ({
  useExplorationHistory: () => ({ pending: [], entries: [], remoteAsOf: null, remoteError: null, refreshLocal: vi.fn(), refreshRemote: vi.fn(), send: vi.fn() }),
}));
vi.mock('../src/components/terrain/useEnvironmentSpots', () => ({
  useEnvironmentSpots: () => ({ species: [], markers: [], pendingObs: [], remoteAsOf: null, remoteError: null, record: vi.fn(), observe: vi.fn(), refreshRemote: vi.fn(), refreshLocal: vi.fn(), resume: vi.fn(), notice: null, clearNotice: vi.fn() }),
}));
const overview = vi.hoisted(() => ({ renders: [] as string[][] }));
vi.mock('../src/components/terrain/AreaOverview', () => ({
  default: ({ entries }: { entries: { areaId: string }[] }) => {
    overview.renders.push(entries.map((e) => e.areaId));
    return <div data-testid="overview">全体図 {entries.map((e) => e.areaId).join(',')}</div>;
  },
}));
const store = vi.hoisted(() => ({
  listSavedAreas: vi.fn(), loadSavedArea: vi.fn(), fetchAreaPackage: vi.fn(), saveAreaPackage: vi.fn(), deleteSavedArea: vi.fn(), loadSavedFile: vi.fn(),
}));
vi.mock('../src/terrain/areaStore', async (orig) => ({ ...(await orig<typeof import('../src/terrain/areaStore')>()), ...store }));
const terrainApi = vi.hoisted(() => ({ fetchTerrainAreas: vi.fn() }));
vi.mock('../src/api/terrainApi', async (orig) => ({ ...(await orig<typeof import('../src/api/terrainApi')>()), ...terrainApi }));
vi.mock('../src/exploration/hypothesisStore', () => ({ listHypotheses: vi.fn(async () => []), saveHypothesis: vi.fn(), deleteHypothesis: vi.fn() }));

const memory = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (k: string) => memory.get(k) ?? null,
  setItem: (k: string, v: string) => { memory.set(k, String(v)); },
  removeItem: (k: string) => { memory.delete(k); },
  clear: () => memory.clear(),
  key: (i: number) => [...memory.keys()][i] ?? null,
  get length() { return memory.size; },
});

const { default: ExplorationMap } = await import('../src/components/terrain/ExplorationMap');

const yoichiB = { south: 43.02, north: 43.26, west: 140.62, east: 141.08 };
const nisekoB = { south: 42.72, north: 43.03, west: 140.45, east: 140.96 };
const manifest = (areaId: string, version: string) => ({ areaId, version, name: areaId, bounds: areaId === 'niseko-yotei' ? nisekoB : yoichiB, files: {}, grid: { width: 1, height: 1, pxM: 21 }, params: {}, sources: [] });
const savedY = { areaId: 'yoichi-akaigawa', version: '20260929-6d7abae2', name: '余市・赤井川・仁木', savedAt: '2026-09-29T00:00:00Z', bytes: 17653311, manifest: manifest('yoichi-akaigawa', '20260929-6d7abae2') };
const remote = [
  { areaId: 'yoichi-akaigawa', name: '余市・赤井川・仁木', version: '20260929-6d7abae2', bounds: yoichiB, totalBytes: 17658012 },
  { areaId: 'niseko-yotei', name: 'ニセコ・羊蹄', version: '20261006-9cb22a8f', bounds: nisekoB, totalBytes: 24342291 },
];
const pkgOf = (m: ReturnType<typeof manifest>) => ({ manifest: m, files: { 'hillshade.jpg': new Blob() }, source: 'saved' as const });

describe('ExplorationMap: 開いた時の山域', () => {
  beforeEach(() => {
    memory.clear();
    overview.renders = [];
    Object.values(store).forEach((f) => f.mockReset());
    terrainApi.fetchTerrainAreas.mockReset().mockResolvedValue(remote);
    store.loadSavedFile.mockResolvedValue(null);
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: () => 'blob:x', revokeObjectURL: () => undefined }));
  });

  it('1. Gate: 余市だけ保存済み → 全体図を一度も出さずに余市を直接開く（ネットから取らない）', async () => {
    store.listSavedAreas.mockResolvedValue([savedY]);
    store.loadSavedArea.mockResolvedValue(pkgOf(savedY.manifest));
    render(<ExplorationMap entries={[]} />);
    await waitFor(() => expect(store.loadSavedArea).toHaveBeenCalledWith('yoichi-akaigawa'));
    await waitFor(() => expect(terrainApi.fetchTerrainAreas).toHaveBeenCalled());
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(overview.renders).toEqual([]);
    expect(screen.queryByTestId('overview')).toBeNull();
    expect(store.fetchAreaPackage).not.toHaveBeenCalled();
    expect(memory.get('icarus:terrain-last-area')).toBe('yoichi-akaigawa');
  });

  it('2. Gate: 新規・未保存の端末（電波あり）→ 全体図から始まり、余市を黙って取りに行かない', async () => {
    store.listSavedAreas.mockResolvedValue([]);
    render(<ExplorationMap entries={[]} />);
    expect(await screen.findByTestId('overview')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('overview').textContent).toContain('yoichi-akaigawa,niseko-yotei'));
    expect(store.fetchAreaPackage).not.toHaveBeenCalled();
    expect(store.loadSavedArea).not.toHaveBeenCalled();
  });

  it('3. 前回ニセコを開いた・両方保存済み → ニセコを開く', async () => {
    memory.set('icarus:terrain-last-area', 'niseko-yotei');
    const savedN = { ...savedY, areaId: 'niseko-yotei', name: 'ニセコ・羊蹄', manifest: manifest('niseko-yotei', '20261006-9cb22a8f') };
    store.listSavedAreas.mockResolvedValue([savedY, savedN]);
    store.loadSavedArea.mockResolvedValue(pkgOf(savedN.manifest));
    render(<ExplorationMap entries={[]} />);
    await waitFor(() => expect(store.loadSavedArea).toHaveBeenCalledWith('niseko-yotei'));
    expect(overview.renders).toEqual([]);
  });

  it('4. 保存データが壊れていて開けない → 全体図へ（オフラインで開けない状態を残さない）', async () => {
    store.listSavedAreas.mockResolvedValue([savedY]);
    store.loadSavedArea.mockResolvedValue(null);
    render(<ExplorationMap entries={[]} />);
    expect(await screen.findByTestId('overview')).toBeInTheDocument();
  });

  it('5. オフライン・未保存 → 全体図（前回の一覧があれば枠を出せる）', async () => {
    terrainApi.fetchTerrainAreas.mockRejectedValue(new (await import('../src/api/terrainApi')).TerrainOfflineError());
    memory.set('icarus:terrain-areas-index', JSON.stringify(remote));
    store.listSavedAreas.mockResolvedValue([]);
    render(<ExplorationMap entries={[]} />);
    expect(await screen.findByTestId('overview')).toBeInTheDocument();
    expect(screen.getByTestId('overview').textContent).toContain('yoichi-akaigawa,niseko-yotei');
  });
});
