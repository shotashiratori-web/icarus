import 'fake-indexeddb/auto';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import EnvironmentSpotRecordSheet from '../src/components/terrain/EnvironmentSpotRecordSheet';
import EnvironmentSpotDetailSheet from '../src/components/terrain/EnvironmentSpotDetailSheet';
import type { EnvSpeciesItem, EnvironmentSpot } from '../src/environmentSpots/types';
import type { SpotMarker } from '../src/components/terrain/useEnvironmentSpots';

// 環境スポットの記録・詳細の画面（S3）: 種類ボタン → 樹種（不明・その他）→ 写真 or 写真なし理由、位置の取り方、
// 観察は対象の初期値なし・あり／なし／見ていない、年ごとの年表

const sp = (id: string, kind: 'tree' | 'target', name: string, extra: Partial<EnvSpeciesItem> = {}): EnvSpeciesItem => ({ id, kind, name, aliases: [], isUnknown: false, isOther: false, sortOrder: 0, status: 'active', ...extra });
const SPECIES = [
  sp('tree-mizunara', 'tree', 'ミズナラ', { sortOrder: 10 }), sp('tree-unknown', 'tree', '不明', { sortOrder: 900, isUnknown: true }),
  sp('tree-other', 'tree', 'その他', { sortOrder: 990, isOther: true }), sp('target-maitake', 'target', 'マイタケ', { sortOrder: 10 }), sp('target-naratake', 'target', 'ナラタケ', { sortOrder: 20 }),
];

describe('EnvironmentSpotRecordSheet', () => {
  it('1. 種類・樹種・写真なし理由がそろうまで保存できない。地図指定は GPS 精度を送らない。記録時の地形を付ける', async () => {
    const onSave = vi.fn(async (..._a: unknown[]) => undefined);
    render(<EnvironmentSpotRecordSheet location={{ lat: 43.1, lng: 140.8, source: 'map', accuracyM: null }} species={SPECIES} terrainAt={async () => ({ terrainVersion: 'v', aspect: '南西' })} onSave={onSave} onClose={vi.fn()} />);
    const save = await screen.findByRole('button', { name: '端末に保存して送信' });
    expect(save).toBeDisabled();
    expect(screen.getByText('地図で指定', { exact: false })).toBeInTheDocument();
    expect(screen.getByText('記録日時: 保存した時刻')).toBeInTheDocument(); // 写真が無い間は保存した時刻
    fireEvent.click(screen.getByRole('button', { name: '倒木' }));
    expect(screen.getByText('樹種を選んでください（分からない時は「不明」）')).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: 'その他' })[1]); // [0] は種類の「その他」、[1] は樹種の「その他」
    expect(save).toBeDisabled(); // その他は名前が必要
    fireEvent.change(screen.getByPlaceholderText('樹種名（例: キハダ）'), { target: { value: 'キハダ' } });
    expect(save).toBeDisabled(); // 写真も理由も無い
    fireEvent.click(screen.getByRole('button', { name: '危険で撮影不可' }));
    fireEvent.click(screen.getByRole('button', { name: '2 一部腐朽' }));
    expect(save).not.toBeDisabled();
    fireEvent.click(save);
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    const [body, photos] = onSave.mock.calls[0] as unknown as [Record<string, unknown>, unknown[]];
    expect(photos).toEqual([]);
    expect(body).toMatchObject({
      envType: 'tree', lifeState: 'fallen', treeSpeciesId: 'tree-other', treeSpeciesText: 'キハダ', decayClass: 2,
      locationSource: 'map', gpsAccuracyM: null, photoMissingReason: 'danger', terrain: { terrainVersion: 'v', aspect: '南西' },
    });
  });

  it('2. 地形は樹種を聞かない（生死は該当なし）。現在地は精度を送る', async () => {
    const onSave = vi.fn(async (..._a: unknown[]) => undefined);
    render(<EnvironmentSpotRecordSheet location={{ lat: 43.1, lng: 140.8, source: 'gps', accuracyM: 12 }} species={SPECIES} terrainAt={async () => null} onSave={onSave} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: '地形' }));
    expect(screen.queryByText('樹種')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '暗い' }));
    fireEvent.click(await screen.findByRole('button', { name: '端末に保存して送信' }));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave.mock.calls[0][0]).toMatchObject({ envType: 'terrain', lifeState: 'na', treeSpeciesId: null, locationSource: 'gps', gpsAccuracyM: 12 });
  });
});

describe('EnvironmentSpotDetailSheet', () => {
  const remote: EnvironmentSpot = {
    id: 's1', title: 'ミズナラ（生木）', envType: 'tree', lifeState: 'alive', treeSpeciesId: 'tree-mizunara', treeSpecies: 'ミズナラ', treeSpeciesText: null,
    dbhCm: 62, decayClass: null, lat: 43.1, lng: 140.8, locationSource: 'gps', gpsAccuracyM: 8, photoMissingReason: null, photoMissingMemo: null,
    photos: [], memo: '', terrain: null, observedAt: '2026-09-29T00:12:00Z', status: 'active', createdByName: '翔大', createdAt: '', updatedAt: '',
    observations: [
      { id: 'o1', observedAt: '2026-09-10T01:00:00Z', targetSpeciesId: 'target-maitake', target: 'マイタケ', targetText: '', result: 'not_found', foundStage: null, memo: '', status: 'active', createdByName: '翔大', createdAt: '', updatedAt: '' },
      { id: 'o2', observedAt: '2027-09-28T01:00:00Z', targetSpeciesId: 'target-maitake', target: 'マイタケ', targetText: '', result: 'found', foundStage: 'prime', memo: '', status: 'active', createdByName: '翔大', createdAt: '', updatedAt: '' },
    ],
  };
  const marker = { key: 's:s1', origin: 'server', spotId: 's1', pendingId: null, lat: 43.1, lng: 140.8, envType: 'tree', lifeState: 'alive', treeSpeciesId: 'tree-mizunara', label: 'ミズナラ（生木）', status: 'registered', error: null, observedAt: null, remote, pending: null } as SpotMarker;

  it('3. 観察を年ごとに表示。対象は未選択から始まり、対象と結果がそろうまで保存できない', async () => {
    const onObserve = vi.fn(async (..._a: unknown[]) => undefined);
    render(<EnvironmentSpotDetailSheet marker={marker} species={SPECIES} pendingObs={[]} idToken={null} onObserve={onObserve} onClose={vi.fn()} />);
    expect(screen.getByText('2027年')).toBeInTheDocument();
    expect(screen.getByText('2026年')).toBeInTheDocument();
    expect(screen.getByText('（適期）', { exact: false })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '観察を追加' }));
    const save = screen.getByRole('button', { name: '端末に保存して送信' });
    expect(save).toBeDisabled();
    expect(screen.getByRole('button', { name: 'マイタケ' }).className).not.toMatch(/on/); // 初期値なし
    fireEvent.click(screen.getByRole('button', { name: 'なし' }));
    expect(save).toBeDisabled(); // 対象が無い
    fireEvent.click(screen.getByRole('button', { name: 'マイタケ' }));
    fireEvent.click(screen.getByRole('button', { name: /記録時と同じ/ })); // 山から戻ってから: 記録時（写真の撮影日時）の観察にする
    fireEvent.click(save);
    await waitFor(() => expect(onObserve).toHaveBeenCalledTimes(1));
    expect(onObserve.mock.calls[0][0]).toEqual({ spotId: 's1', pendingSpotId: null });
    expect(onObserve.mock.calls[0][1]).toMatchObject({ targetSpeciesId: 'target-maitake', targetText: '', result: 'not_found', foundStage: null, observedAt: '2026-09-29T00:12:00Z' });
  });
});

describe('樹種を選びやすく・撮った写真から記録', () => {
  // この jsdom では localStorage が無いため、メモリ上の置き換えを使う（ZukanFieldMapScreen.mode.test と同じ）
  const mem = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k), clear: () => mem.clear() });
  it('4. この場所の林分の樹種とよく使う樹種を先頭に。撮った写真の撮影日時を記録日時に、位置は写真の GPS', async () => {
    localStorage.setItem('icarus:spot-species-usage', JSON.stringify({ 'tree-unknown': 3 }));
    const onSave = vi.fn(async (..._a: unknown[]) => undefined);
    const species = [...SPECIES, sp('tree-buna', 'tree', 'ブナ', { sortOrder: 20, aliases: ['ぶな'] })];
    render(<EnvironmentSpotRecordSheet
      location={{ lat: 43.1, lng: 140.8, source: 'gps', accuracyM: 6, fromPhoto: true }}
      species={species}
      terrainAt={async () => ({ forestStand: { species: ['カンバ', 'ミズナラ', 'ぶな'] } })}
      onSave={onSave} onClose={vi.fn()}
      initialPhotos={[{ id: 'p1', name: 'IMG_3193.HEIC', type: 'image/heic', data: new ArrayBuffer(3), bytes: 3, sha256: 'a'.repeat(64), assetId: null }]}
      observedAt="2026-09-30T02:10:00.000Z"
    />);
    expect(screen.getByText('写真の撮影時の GPS', { exact: false })).toBeInTheDocument();
    expect(screen.getByText('（写真の撮影日時）', { exact: false })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '生木' }));
    expect(await screen.findByText('この場所の林分（森林計画）の樹種')).toBeInTheDocument(); // 地形は非同期で計算
    expect(screen.getByText('よく使う')).toBeInTheDocument();
    const chips = screen.getAllByRole('button').map((b) => b.textContent);
    // 林分の樹種（ミズナラ・ブナ。カンバは樹種マスタに無いので出さない）→ よく使う（不明）→ ほか
    expect(chips.indexOf('ミズナラ')).toBeLessThan(chips.indexOf('不明'));
    expect(chips.indexOf('ブナ')).toBeLessThan(chips.indexOf('不明'));
    expect(chips.indexOf('不明')).toBeLessThan(chips.lastIndexOf('その他'));
    fireEvent.click(screen.getByRole('button', { name: 'ミズナラ' }));
    fireEvent.click(await screen.findByRole('button', { name: '端末に保存して送信' }));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave.mock.calls[0][0]).toMatchObject({ treeSpeciesId: 'tree-mizunara', observedAt: '2026-09-30T02:10:00.000Z', locationSource: 'gps', gpsAccuracyM: 6 });
    expect((onSave.mock.calls[0][1] as unknown[]).length).toBe(1);
    expect(JSON.parse(localStorage.getItem('icarus:spot-species-usage')!)['tree-mizunara']).toBe(1);
  });
});

describe('現在地のまま古い写真で記録しない（自宅の位置で登録された実例）', () => {
  it('5. 写真が 30 分以上前で位置が現在地なら警告して保存できない。座標を入れると地図指定で保存', async () => {
    const onSave = vi.fn(async (..._a: unknown[]) => undefined);
    render(<EnvironmentSpotRecordSheet location={{ lat: 43.19135, lng: 140.79865, source: 'gps', accuracyM: 10 }} species={SPECIES} terrainAt={async (lat) => ({ at: lat })} onSave={onSave} onClose={vi.fn()} observedAt="2026-09-30T00:14:16.000Z" />);
    fireEvent.click(screen.getByRole('button', { name: '生木' }));
    fireEvent.click(screen.getByRole('button', { name: 'ミズナラ' }));
    fireEvent.click(screen.getByRole('button', { name: '暗い' }));
    const save = await screen.findByRole('button', { name: '端末に保存して送信' });
    expect(save).toBeDisabled();
    expect(screen.getByText('木の場所ではない可能性があります', { exact: false })).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText('木の座標 例: 43.05435, 140.78771'), { target: { value: '43.05435, 140.78771' } });
    fireEvent.click(screen.getByRole('button', { name: 'この座標にする' }));
    await waitFor(() => expect(save).not.toBeDisabled()); // 新しい地点の地形を計算し直してから保存できる
    fireEvent.click(save);
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave.mock.calls[0][0]).toMatchObject({ lat: 43.05435, lng: 140.78771, locationSource: 'map', gpsAccuracyM: null, observedAt: '2026-09-30T00:14:16.000Z', terrain: { at: 43.05435 } });
  });
});
