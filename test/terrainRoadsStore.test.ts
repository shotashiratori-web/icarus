import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { describeRoad, groupByClass, indexRoads, nearestRoad, TRAIL_CLASSES, VEHICLE_CLASSES } from '../src/terrain/roads';
import type { RoadLine, TerrainManifest } from '../src/terrain/types';
import { entryScriptOf } from '../src/utils/appShell';

// 地形探索（Exploration Mode Stage 1）: 最寄りの道・エリアパッケージの端末保存・更新判定

const LINES: RoadLine[] = [
  { c: 'road', p: [[43.0, 140.0], [43.0, 140.01]], s: '国土地理院' },
  { c: 'forest', p: [[43.002, 140.0], [43.002, 140.01]], n: '赤井川林道', f: 'gravel', s: 'OSM' },
  { c: 'trail', p: [[43.005, 140.0], [43.005, 140.01]], s: '国土地理院' },
];

describe('roads', () => {
  it('1. 種類ごとにまとめる', () => {
    const g = groupByClass(LINES);
    expect(g.road).toHaveLength(1);
    expect(g.forest).toHaveLength(1);
    expect(g.trail).toHaveLength(1);
    expect(g.narrow).toHaveLength(0);
  });

  it('2. 最寄りの車道・林道と徒歩道（線分への距離、名前・舗装つき）', () => {
    const idx = indexRoads(LINES);
    const near = nearestRoad(idx, 43.0021, 140.005, VEHICLE_CLASSES)!;
    expect(near.line.n).toBe('赤井川林道');
    expect(near.distanceM).toBeCloseTo(0.1 * 1e-3 * 111320, 0);
    expect(describeRoad(near)).toBe('約10m（赤井川林道・gravel）');
    const trail = nearestRoad(idx, 43.0021, 140.005, TRAIL_CLASSES)!;
    expect(trail.distanceM).toBeCloseTo(0.0029 * 111320, 0);
    expect(nearestRoad(idx, 43.1, 140.005, VEHICLE_CLASSES)).toBeNull();
    expect(describeRoad(null)).toBe('1.5km 以内になし');
  });
});

describe('appShell', () => {
  it('3. index.html から入口の JS を取り出す（属性の順番が違っても）', () => {
    expect(entryScriptOf('<script type="module" crossorigin src="./assets/index-AAA.js"></script>')).toBe('./assets/index-AAA.js');
    expect(entryScriptOf('<script crossorigin src="./assets/index-BBB.js" type="module"></script>')).toBe('./assets/index-BBB.js');
    expect(entryScriptOf('<p>no script</p>')).toBeNull();
  });
});

// ---- 端末保存 ----
const bytes = (s: string) => new Blob([s]);
async function sha(s: string) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return Array.from(new Uint8Array(d)).map((b) => b.toString(16).padStart(2, '0')).join('');
}
async function makeManifest(version: string, contents: Record<string, string>): Promise<TerrainManifest> {
  const files = {} as TerrainManifest['files'];
  for (const [k, v] of Object.entries(contents)) files[k as keyof TerrainManifest['files']] = { bytes: v.length, sha256: await sha(v) };
  return {
    areaId: 'yoichi-akaigawa', name: '余市・赤井川・仁木', version, createdAt: '',
    bounds: { south: 43, north: 43.2, west: 140.6, east: 141 },
    grid: { width: 1, height: 1, pxM: 20, z: 14, tx0: 0, ty0: 0, factor: 3, cropX: 0, cropY: 0 },
    landKm2: 0, params: { date: '', slope_scale: 2.8, rel_scale: 170, ridge_dist_max_px: 10, access_dist_max_px: 40 },
    relPercentiles: { '50': 1, '60': 1, '70': 1, '80': 1, '90': 1 }, sources: [], files,
  };
}
const CONTENTS = (v: string) => ({ 'terrain.png': `t-${v}`, 'access.png': `a-${v}`, 'roads.json': '[]', 'hillshade.jpg': `h-${v}` });

describe('areaStore', () => {
  beforeEach(async () => {
    const { closeAreaStoreForTest } = await import('../src/terrain/areaStore');
    await closeAreaStoreForTest();
    await new Promise<void>((r) => { const req = indexedDB.deleteDatabase('icarus-terrain'); req.onsuccess = () => r(); req.onerror = () => r(); req.onblocked = () => r(); });
    vi.restoreAllMocks();
  });

  function mockServer(manifest: TerrainManifest, contents: Record<string, string>, broken?: string) {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      const file = url.split('/').pop()!;
      if (file === 'manifest.json') return new Response(JSON.stringify(manifest));
      return new Response(file === broken ? 'broken' : contents[file]);
    });
  }

  it('4. 取得 → sha256 検証 → 保存 → 圏外でも読める。新しい版で上書きすると古い版のファイルは消える', async () => {
    const store = await import('../src/terrain/areaStore');
    const m1 = await makeManifest('20260928-11111111', CONTENTS('v1'));
    mockServer(m1, CONTENTS('v1'));
    const area = { areaId: m1.areaId, name: m1.name, version: m1.version, bounds: m1.bounds, totalBytes: 1 };
    const pkg = await store.fetchAreaPackage(area, 'tok');
    expect(pkg.source).toBe('network');
    await store.saveAreaPackage(pkg);
    expect((await store.listSavedAreas()).map((a) => a.version)).toEqual([m1.version]);

    vi.mocked(fetch).mockRejectedValue(new TypeError('offline'));
    const offline = await store.loadSavedArea(m1.areaId);
    expect(offline?.source).toBe('saved');
    expect(await offline!.files['terrain.png'].text()).toBe('t-v1');

    const m2 = await makeManifest('20261001-22222222', CONTENTS('v2'));
    mockServer(m2, CONTENTS('v2'));
    await store.saveAreaPackage(await store.fetchAreaPackage({ ...area, version: m2.version }, 'tok'));
    const saved = await store.listSavedAreas();
    expect(saved.map((a) => a.version)).toEqual([m2.version]);
    expect(await (await store.loadSavedArea(m1.areaId))!.files['terrain.png'].text()).toBe('t-v2');

    await store.deleteSavedArea(m1.areaId);
    expect(await store.listSavedAreas()).toEqual([]);
    expect(await store.loadSavedArea(m1.areaId)).toBeNull();
  });

  it('5. 中身が manifest の sha256 と違えば保存しない（壊れたデータを山へ持っていかない）', async () => {
    const store = await import('../src/terrain/areaStore');
    const m1 = await makeManifest('20260928-11111111', CONTENTS('v1'));
    mockServer(m1, CONTENTS('v1'), 'access.png');
    const area = { areaId: m1.areaId, name: m1.name, version: m1.version, bounds: m1.bounds, totalBytes: 1 };
    await expect(store.fetchAreaPackage(area, 'tok')).rejects.toThrow('壊れています');
    expect(await store.listSavedAreas()).toEqual([]);
  });

  it('4b. 等高線は版によって有無が違う: 古い版（無し）→ 新しい版（有り）→ 古い版のファイルは残らない。新しい版から戻しても等高線は残らない', async () => {
    const store = await import('../src/terrain/areaStore');
    const m1 = await makeManifest('20260928-11111111', CONTENTS('v1'));
    mockServer(m1, CONTENTS('v1'));
    const area = { areaId: m1.areaId, name: m1.name, version: m1.version, bounds: m1.bounds, totalBytes: 1 };
    await store.saveAreaPackage(await store.fetchAreaPackage(area, 'tok'));
    const old = await store.loadSavedArea(m1.areaId);
    expect(old!.files['contours.json']).toBeUndefined(); // 古い版はそのまま使える

    const withContours = { ...CONTENTS('v2'), 'contours.json': '{"format":"delta-e5","intervalM":10,"indexM":50,"lines":[]}' };
    const m2 = await makeManifest('20260929-22222222', withContours);
    mockServer(m2, withContours);
    const s2 = await store.saveAreaPackage(await store.fetchAreaPackage({ ...area, version: m2.version }, 'tok'));
    expect(s2.bytes).toBe(Object.values(withContours).reduce((n, v) => n + v.length, 0));
    const now = await store.loadSavedArea(m1.areaId);
    expect(await now!.files['contours.json']!.text()).toContain('delta-e5');
    const keys = async () => {
      const d = await new Promise<IDBDatabase>((r) => { const q = indexedDB.open('icarus-terrain'); q.onsuccess = () => r(q.result); });
      const all = await new Promise<IDBValidKey[]>((r) => { const q = d.transaction('files').objectStore('files').getAllKeys(); q.onsuccess = () => r(q.result); });
      d.close();
      return all.map(String).sort();
    };
    expect(await keys()).toEqual(Object.keys(withContours).map((f) => `${m1.areaId}/${m2.version}/${f}`).sort());

    // 新しい版 → 等高線の無い版（戻した場合）: 新しい版の contours.json も消える
    const m3 = await makeManifest('20261001-33333333', CONTENTS('v3'));
    mockServer(m3, CONTENTS('v3'));
    await store.saveAreaPackage(await store.fetchAreaPackage({ ...area, version: m3.version }, 'tok'));
    expect(await keys()).toEqual(Object.keys(CONTENTS('v3')).map((f) => `${m1.areaId}/${m3.version}/${f}`).sort());
    await store.deleteSavedArea(m1.areaId);
    expect(await keys()).toEqual([]);
  });

  it('4c. manifest に等高線があるのに欠けている・壊れている版は保存しない', async () => {
    const store = await import('../src/terrain/areaStore');
    const withContours = { ...CONTENTS('v2'), 'contours.json': '{"lines":[]}' };
    const m2 = await makeManifest('20260929-22222222', withContours);
    mockServer(m2, withContours, 'contours.json');
    const area = { areaId: m2.areaId, name: m2.name, version: m2.version, bounds: m2.bounds, totalBytes: 1 };
    await expect(store.fetchAreaPackage(area, 'tok')).rejects.toThrow('contours.json');
    expect(await store.listSavedAreas()).toEqual([]);
  });

  it('6. 401 はログイン切れとして伝える', async () => {
    const store = await import('../src/terrain/areaStore');
    const { TokenExpiredError } = await import('../src/api/icarusApi');
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 401 }));
    const m1 = await makeManifest('20260928-11111111', CONTENTS('v1'));
    await expect(store.fetchAreaPackage({ areaId: m1.areaId, name: '', version: m1.version, bounds: m1.bounds, totalBytes: 1 }, 'tok'))
      .rejects.toBeInstanceOf(TokenExpiredError);
    void bytes;
  });
});
