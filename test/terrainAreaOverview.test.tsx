import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { mergeAreas } from '../src/terrain/areaSelection';
import type { SavedArea } from '../src/terrain/areaStore';
import type { TerrainManifest } from '../src/terrain/types';

// 全体図（山域を選ぶ）: 状態・容量・山域ごとの保存／開く／削除・オフライン・現在地（設計 §2-2・§2-3）

vi.mock('react-leaflet', () => {
  const Pass = ({ children }: { children?: unknown }) => <>{children as never}</>;
  const Null = () => null;
  return { MapContainer: Pass, TileLayer: Null, ImageOverlay: Null, Rectangle: Pass, Tooltip: Null, CircleMarker: Null };
});
vi.mock('../src/terrain/areaStore', () => ({ loadSavedFile: vi.fn(async () => null) }));
const { default: AreaOverview } = await import('../src/components/terrain/AreaOverview');

const yoichiB = { south: 43.02, north: 43.26, west: 140.62, east: 141.08 };
const nisekoB = { south: 42.72, north: 43.03, west: 140.45, east: 140.96 };
const remote = [
  { areaId: 'yoichi-akaigawa', name: '余市・赤井川・仁木', version: 'v2', bounds: yoichiB, totalBytes: 17658012 },
  { areaId: 'niseko-yotei', name: 'ニセコ・羊蹄', version: 'n1', bounds: nisekoB, totalBytes: 24342291 },
];
const savedY = (version: string): SavedArea => ({ areaId: 'yoichi-akaigawa', version, name: '余市・赤井川・仁木', savedAt: '2026-09-29T00:00:00Z', bytes: 17653311, manifest: { bounds: yoichiB } as TerrainManifest });

function setup(over: Partial<Parameters<typeof AreaOverview>[0]> = {}) {
  const props = {
    entries: mergeAreas(remote, [savedY('v2')], []), online: true, currentAreaId: 'yoichi-akaigawa', pos: null, saving: null, error: null,
    onOpen: vi.fn(), onSave: vi.fn(), onDelete: vi.fn(), onBack: vi.fn(), ...over,
  };
  render(<AreaOverview {...props} />);
  return props;
}

describe('AreaOverview', () => {
  it('1. 山域ごとの状態と容量（保存済み・未保存）', () => {
    setup();
    expect(screen.getByRole('button', { name: /余市・赤井川・仁木（表示中）.*✓ 保存済み.*17.7MB/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /ニセコ・羊蹄.*↓ 未保存.*24.3MB/ })).toBeInTheDocument();
  });

  it('2. 未保存の山域: 「保存して開く 24.3MB」が主、「保存せずに見る」は副', () => {
    const p = setup();
    fireEvent.click(screen.getByRole('button', { name: /ニセコ・羊蹄.*未保存/ }));
    fireEvent.click(screen.getByRole('button', { name: 'ニセコ・羊蹄を保存して開く 24.3MB' }));
    expect(p.onSave).toHaveBeenCalledWith('niseko-yotei');
    fireEvent.click(screen.getByRole('button', { name: /保存せずに見る（開くたびに 24.3MB を取得）/ }));
    expect(p.onOpen).toHaveBeenCalledWith('niseko-yotei', 'network');
  });

  it('3. 保存済み: 開く・新しい版を保存・削除は 2 段（ブラウザのダイアログを出さない）', () => {
    const p = setup({ entries: mergeAreas(remote, [savedY('v1')], []) });
    fireEvent.click(screen.getByRole('button', { name: /余市・赤井川・仁木.*⟳ 新しい版あり/ }));
    fireEvent.click(screen.getByRole('button', { name: '開く' }));
    expect(p.onOpen).toHaveBeenCalledWith('yoichi-akaigawa', 'saved');
    fireEvent.click(screen.getByRole('button', { name: '新しい版を保存 17.7MB' }));
    expect(p.onSave).toHaveBeenCalledWith('yoichi-akaigawa');
    fireEvent.click(screen.getByRole('button', { name: 'この山域の保存を削除' }));
    expect(p.onDelete).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '保存を削除する（17.7MB）' }));
    expect(p.onDelete).toHaveBeenCalledWith('yoichi-akaigawa');
  });

  it('4. オフライン: 未保存の山域は開けず、理由を出す。保存済みは開ける', () => {
    const p = setup({ online: false, entries: mergeAreas(null, [savedY('v2')], remote) });
    fireEvent.click(screen.getByRole('button', { name: /ニセコ・羊蹄.*未保存（電波が必要）/ }));
    expect(screen.getByText('この山域は未保存です。電波のある所で保存してください')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /保存して開く/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /余市・赤井川・仁木/ }));
    fireEvent.click(screen.getByRole('button', { name: '開く' }));
    expect(p.onOpen).toHaveBeenCalledWith('yoichi-akaigawa', 'saved');
  });

  it('5. 現在地がどの山域の中か（羊蹄山）。戻るボタン', () => {
    const p = setup({ pos: { lat: 42.83, lng: 140.81 } });
    expect(screen.getByText('現在地はニセコ・羊蹄の中です')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '← 地図へ戻る' }));
    expect(p.onBack).toHaveBeenCalled();
  });

  it('7. 山域を開いている途中（取得中）の進み具合を一覧の上に出す', () => {
    setup({ saving: { areaId: '', text: 'ニセコ・羊蹄を取得中…（2/9）' } });
    expect(screen.getByText('ニセコ・羊蹄を取得中…（2/9）')).toBeInTheDocument();
  });

  it('6. 保存中は他の操作を押せない', () => {
    setup({ saving: { areaId: 'niseko-yotei', text: 'ニセコ・羊蹄を保存中…（3/9）' } });
    fireEvent.click(screen.getByRole('button', { name: /ニセコ・羊蹄.*未保存/ }));
    expect(screen.getByText('ニセコ・羊蹄を保存中…（3/9）')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /保存して開く/ })).toBeDisabled();
  });
});
