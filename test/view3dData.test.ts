import { describe, expect, it } from 'vitest';
import { BLANK_PNG, LAYER_SLOTS, layerImage, pointsGeoJSON, POINT_COLOR, spotsGeoJSON, tracksGeoJSON } from '../src/terrain/view3dData';

// 3D パネル統合 PR1（icarus_3d_panel_integration_v1_design.md）: 3D を開いたまま 2D の変化に追従するためのデータの形

describe('3D の重ね表示の枠', () => {
  it('枠は下から 森林・候補・水・対象・条件に合う範囲・輪郭 の順', () => {
    expect(LAYER_SLOTS).toEqual(['forest', 'candidates', 'hydro', 'target', 'match', 'outline']);
  });
  it('中身が無い枠は透明の画像で隠す。ある時はその画像と濃さ', () => {
    expect(layerImage({ url: null, opacity: 1 })).toEqual({ url: BLANK_PNG, visible: false, opacity: 1 });
    expect(layerImage({ url: 'blob:x', opacity: 0.3 })).toEqual({ url: 'blob:x', visible: true, opacity: 0.3 });
  });
});

describe('点・線の GeoJSON', () => {
  it('探索履歴: [lat, lng] → [lng, lat]。無ければ空', () => {
    expect(tracksGeoJSON([[[43, 140], [43.1, 140.1]]]).features[0].geometry.coordinates).toEqual([[[140, 43], [140.1, 43.1]]]);
    expect(tracksGeoJSON([]).features).toEqual([]);
  });
  it('環境スポット: 押した時に元の配列を引けるよう番号を持つ', () => {
    const fc = spotsGeoJSON([{ lat: 43, lng: 140, label: 'ミズナラ', color: '#2e7d32', mizunara: true }]);
    expect(fc.features[0]).toMatchObject({ properties: { idx: 0, label: 'ミズナラ', mizunara: true }, geometry: { coordinates: [140, 43] } });
  });
  it('Field Log の点: 色と大きさ（ミズナラを探す の点は別の色・小さく）。無ければ今までの緑', () => {
    const fc = pointsGeoJSON([{ lat: 43, lng: 140, label: 'a' }, { lat: 43, lng: 140, label: 'b', color: '#e65100', radius: 3.5 }]);
    expect(fc.features.map((f) => f.properties)).toEqual([{ label: 'a', color: POINT_COLOR, radius: 5 }, { label: 'b', color: '#e65100', radius: 3.5 }]);
  });
});

describe('枠の差し替え（3D の地形は画像の差し替えでしか描き直されない）', () => {
  it('濃さだけが変わっても「変わった」とする。何も変わらなければ触らない', async () => {
    const { slotChanged } = await import('../src/terrain/view3dData');
    const a = layerImage({ url: 'blob:c', opacity: 0.3 });
    expect(slotChanged(a, layerImage({ url: 'blob:c', opacity: 1 }))).toBe(true);
    expect(slotChanged(a, layerImage({ url: 'blob:d', opacity: 0.3 }))).toBe(true);
    expect(slotChanged(a, layerImage({ url: null, opacity: 0.3 }))).toBe(true);
    expect(slotChanged(a, layerImage({ url: 'blob:c', opacity: 0.3 }))).toBe(false);
    expect(slotChanged(undefined, a)).toBe(true);
  });
});
