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

describe('道（PR2）', () => {
  it('2D の「道路・林道」「登山道・徒歩道」に従って種類を入れる。[lat,lng] → [lng,lat]', async () => {
    const { roadsGeoJSON } = await import('../src/terrain/view3dData');
    const g = { road: [[[43, 140], [43.1, 140.1]]], narrow: [[[43, 140], [43, 140.2]]], forest: [[[43.2, 140], [43.3, 140]]], trail: [[[43.4, 140], [43.5, 140]]] } as never;
    expect(roadsGeoJSON(g, { road: true, trail: true }).features.map((f) => f.properties.c)).toEqual(['road', 'narrow', 'forest', 'trail']);
    expect(roadsGeoJSON(g, { road: true, trail: false }).features.map((f) => f.properties.c)).toEqual(['road', 'narrow', 'forest']);
    expect(roadsGeoJSON(g, { road: false, trail: true }).features.map((f) => f.properties.c)).toEqual(['trail']);
    expect(roadsGeoJSON(null, { road: true, trail: true }).features).toEqual([]);
    expect(roadsGeoJSON(g, { road: true, trail: false }).features[0].geometry.coordinates).toEqual([[[140, 43], [140.1, 43.1]]]);
  });
  it('見た目は 2D と同じ（破線は線の太さを単位に）', async () => {
    const { ROAD_PAINT_3D } = await import('../src/terrain/view3dData');
    const by = Object.fromEntries(ROAD_PAINT_3D.map((r) => [r.c, r]));
    expect(by.forest).toMatchObject({ color: '#f08c00', width: 3, dash: null });
    expect(by.narrow).toMatchObject({ color: '#f08c00', width: 2, dash: [3, 2] });
    expect(by.trail).toMatchObject({ color: '#212529', dash: [1, 2.5], round: true });
    expect(by.road).toMatchObject({ color: '#343a40', casingWidth: 5.2 });
  });
});

describe('古い林分へ飛ぶ（PR3）', () => {
  it('林分の格子の範囲（両端を含む）を経緯度の範囲に。北西は左上の格子、南東は右下の格子の外側の角', async () => {
    const { focusFromBox } = await import('../src/terrain/view3dData');
    const toLatLng = (x: number, y: number) => ({ lat: 43.2 - y * 0.001, lng: 140.6 + x * 0.001 });
    expect(focusFromBox(toLatLng, { x0: 10, y0: 20, x1: 12, y1: 25 }, 7)).toEqual({ key: 7, north: 43.2 - 0.02, west: 140.6 + 0.01, south: 43.2 - 0.026, east: 140.6 + 0.013 });
  });
});

describe('探索計画（3D は下見用）', () => {
  const route = {
    name: '10/27 探索',
    points: [
      { lat: 43.1, lng: 140.8 },
      { lat: 43.11, lng: 140.81, kind: 'via' as const },
      { lat: 43.12, lng: 140.82, kind: 'stop' as const, name: '尾根に上がる', stayMin: 0 },
      { lat: 43.13, lng: 140.83, kind: 'candidate' as const, name: '霜M1', memo: '林縁', stayMin: 20, setTitle: 'シモフリ' },
      { lat: 43.14, lng: 140.84, kind: 'via' as const },
    ],
  };
  it('線は全部の点を通る（経由点も）。点が 1 つの計画は線にしない', async () => {
    const { routeLines3D } = await import('../src/terrain/view3dData');
    expect(routeLines3D([route, { name: 'x', points: [{ lat: 1, lng: 2 }] }])).toEqual([route.points.map((p) => [p.lat, p.lng])]);
  });
  it('目印は S・G・立ち寄り地点・既存候補だけ。経由点は出さない', async () => {
    const { routeMarks3D } = await import('../src/terrain/view3dData');
    const m = routeMarks3D([route]);
    expect(m.map((x) => [x.label, x.role])).toEqual([['S', 'start'], ['尾根に上がる', 'stop'], ['霜M1', 'candidate'], ['G', 'goal']]);
    expect(m[1]).toMatchObject({ stayMin: 0, plan: '10/27 探索' });
    expect(m[2]).toMatchObject({ memo: '林縁', stayMin: 20, setTitle: 'シモフリ' });
    expect(m[0].stayMin).toBeUndefined();
  });
  it('始点が立ち寄り地点なら「S 名前」', async () => {
    const { routeMarks3D } = await import('../src/terrain/view3dData');
    const m = routeMarks3D([{ name: 'a', points: [{ lat: 1, lng: 2, kind: 'stop', name: '駐車地' }, { lat: 1.1, lng: 2 }] }]);
    expect(m.map((x) => x.label)).toEqual(['S 駐車地', 'G']);
  });
});
