import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import EnvironmentSpotEditForm from '../src/components/terrain/EnvironmentSpotEditForm';
import EnvironmentSpotDetailSheet from '../src/components/terrain/EnvironmentSpotDetailSheet';
import type { EnvSpeciesItem, EnvironmentSpot } from '../src/environmentSpots/types';
import type { SpotMarker } from '../src/components/terrain/useEnvironmentSpots';

// 環境スポットの訂正・無効化（S3 の残り）: 変えた項目だけを理由つきで送る。座標は現在地で取り直す（GPS 精度つき）。
// 無効化は管理者だけ。観察の訂正。衝突（409）は開き直してもらう

const sp = (id: string, kind: 'tree' | 'target', name: string, extra: Partial<EnvSpeciesItem> = {}): EnvSpeciesItem => ({ id, kind, name, aliases: [], isUnknown: false, isOther: false, sortOrder: 0, status: 'active', ...extra });
const SPECIES = [sp('tree-mizunara', 'tree', 'ミズナラ', { sortOrder: 10 }), sp('tree-buna', 'tree', 'ブナ', { sortOrder: 20 }), sp('target-maitake', 'target', 'マイタケ')];
const spot: EnvironmentSpot = {
  id: 's1', title: 'ミズナラ（生木）', envType: 'tree', lifeState: 'alive', treeSpeciesId: 'tree-mizunara', treeSpecies: 'ミズナラ', treeSpeciesText: null,
  dbhCm: 62, decayClass: null, lat: 43.1, lng: 140.8, locationSource: 'gps', gpsAccuracyM: 8, photoMissingReason: null, photoMissingMemo: null,
  photos: [], memo: '尾根', terrain: null, observedAt: '2026-09-29T00:12:00Z', status: 'active', createdByName: '翔大', createdAt: '', updatedAt: 'U1',
  observations: [{ id: 'o1', observedAt: '2026-09-30T01:00:00Z', targetSpeciesId: 'target-maitake', target: 'マイタケ', targetText: '', result: 'not_checked', foundStage: null, memo: '', status: 'active', createdByName: '翔大', createdAt: '', updatedAt: 'OU1' }],
};
const marker = { key: 's:s1', origin: 'server', spotId: 's1', pendingId: null, lat: 43.1, lng: 140.8, envType: 'tree', lifeState: 'alive', treeSpeciesId: 'tree-mizunara', label: 'ミズナラ（生木）', status: 'registered', error: null, observedAt: null, remote: spot, pending: null } as SpotMarker;

function mockFetch(status = 200) {
  const calls: { url: string; method: string; body: Record<string, unknown> }[] = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    calls.push({ url: String(input), method: init?.method ?? 'GET', body: init?.body ? JSON.parse(String(init.body)) : {} });
    if ((init?.method ?? 'GET') === 'GET') return new Response(JSON.stringify({ item: spot }));
    return status === 200 ? new Response(JSON.stringify({ outcome: 'applied' })) : new Response(JSON.stringify({ status: 'error', code: 'EDIT_CONFLICT', message: 'x' }), { status });
  });
  return calls;
}

afterEach(() => vi.restoreAllMocks());

describe('EnvironmentSpotEditForm', () => {
  it('1. 変えた項目だけを理由つきで送る。変更が無ければ送れない。座標は現在地で取り直す', async () => {
    const calls = mockFetch();
    const onDone = vi.fn();
    render(<EnvironmentSpotEditForm spot={spot} species={SPECIES} idToken="tok" here={{ lat: 43.1001, lng: 140.8002, accuracy: 5 }} onDone={onDone} onCancel={vi.fn()} />);
    const send = screen.getByRole('button', { name: '訂正を送信' });
    expect(send).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'ブナ' }));
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.change(screen.getByPlaceholderText('例: 樹種の見間違い'), { target: { value: '樹皮で再確認' } });
    fireEvent.click(send);
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(calls[0]).toMatchObject({ method: 'PATCH', body: { expectedUpdatedAt: 'U1', reason: '樹皮で再確認', changes: { treeSpeciesId: 'tree-buna', location: { lat: 43.1001, lng: 140.8002, source: 'gps', gpsAccuracyM: 5 } } } });
    expect(Object.keys(calls[0].body.changes as object).sort()).toEqual(['location', 'treeSpeciesId']);
  });

  it('2. 衝突（409）は開き直すよう伝える', async () => {
    mockFetch(409);
    render(<EnvironmentSpotEditForm spot={spot} species={SPECIES} idToken="tok" here={null} onDone={vi.fn()} onCancel={vi.fn()} />);
    fireEvent.change(screen.getAllByRole('textbox')[0], { target: { value: '尾根の肩' } });
    fireEvent.click(screen.getByRole('button', { name: '訂正を送信' }));
    expect(await screen.findByText('他の人が先にこの記録を更新しました。閉じて開き直してから訂正してください')).toBeInTheDocument();
  });
});

describe('EnvironmentSpotDetailSheet の訂正・無効化', () => {
  it('3. 無効化は管理者だけに出る。管理者は理由つきで無効化できる', async () => {
    const calls = mockFetch();
    const { unmount } = render(<EnvironmentSpotDetailSheet marker={marker} species={SPECIES} pendingObs={[]} idToken="tok" onObserve={vi.fn()} onClose={vi.fn()} />);
    expect(screen.queryByRole('button', { name: '無効化（管理者）' })).toBeNull();
    unmount();
    const onClose = vi.fn();
    const onChanged = vi.fn();
    render(<EnvironmentSpotDetailSheet marker={marker} species={SPECIES} pendingObs={[]} idToken="tok" onObserve={vi.fn()} onClose={onClose} isAdmin onChanged={onChanged} />);
    fireEvent.click(screen.getByRole('button', { name: '無効化（管理者）' }));
    fireEvent.change(screen.getByPlaceholderText('理由（任意・履歴に残ります）'), { target: { value: '重複登録' } });
    fireEvent.click(screen.getByRole('button', { name: '無効化する' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    const patch = calls.find((c) => c.method === 'PATCH')!;
    expect(patch.url).toMatch(/\/environment-spots\/s1$/);
    expect(patch.body).toMatchObject({ changes: { status: 'archived' }, reason: '重複登録', expectedUpdatedAt: 'U1' });
    expect(onChanged).toHaveBeenCalled();
  });

  it('4. 観察の訂正（見ていない → なし）', async () => {
    const calls = mockFetch();
    render(<EnvironmentSpotDetailSheet marker={marker} species={SPECIES} pendingObs={[]} idToken="tok" onObserve={vi.fn()} onClose={vi.fn()} />);
    fireEvent.click(screen.getAllByRole('button', { name: '訂正' })[1]); // [0] はスポット本体、[1] は観察
    fireEvent.click(screen.getAllByRole('button', { name: 'なし' })[0]);
    fireEvent.change(screen.getByPlaceholderText('訂正の理由（任意）'), { target: { value: '探したが無かった' } });
    fireEvent.click(screen.getByRole('button', { name: '訂正を送信' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'PATCH')).toBe(true));
    const patch = calls.find((c) => c.method === 'PATCH')!;
    expect(patch.url).toMatch(/\/spot-observations\/o1$/);
    expect(patch.body).toMatchObject({ changes: { result: 'not_found' }, reason: '探したが無かった', expectedUpdatedAt: 'OU1' });
  });

  it('5. 観察の日時を訂正できる（家で入力して保存時刻になった時）。日時だけ変えたら observedAt だけを送る', async () => {
    const calls = mockFetch();
    render(<EnvironmentSpotDetailSheet marker={marker} species={SPECIES} pendingObs={[]} idToken="tok" onObserve={vi.fn()} onClose={vi.fn()} />);
    fireEvent.click(screen.getAllByRole('button', { name: '訂正' })[1]);
    fireEvent.click(screen.getByRole('button', { name: /^記録時と同じ/ }));
    fireEvent.click(screen.getByRole('button', { name: '訂正を送信' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'PATCH')).toBe(true));
    const patch = calls.find((c) => c.method === 'PATCH')!;
    expect(patch.body.changes).toEqual({ observedAt: '2026-09-29T00:12:00Z' });
  });

  it('6. 日時入力で訂正（端末の時刻 → ISO）', async () => {
    const calls = mockFetch();
    render(<EnvironmentSpotDetailSheet marker={marker} species={SPECIES} pendingObs={[]} idToken="tok" onObserve={vi.fn()} onClose={vi.fn()} />);
    fireEvent.click(screen.getAllByRole('button', { name: '訂正' })[1]);
    fireEvent.change(screen.getByLabelText('観察日時の訂正'), { target: { value: '2026-09-30T09:09' } });
    fireEvent.click(screen.getByRole('button', { name: '訂正を送信' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'PATCH')).toBe(true));
    const patch = calls.find((c) => c.method === 'PATCH')!;
    expect(patch.body.changes).toEqual({ observedAt: new Date('2026-09-30T09:09').toISOString() });
  });
});

describe('EnvironmentSpotDetailSheet の写真の追加', () => {
  const jpeg = () => new File([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], 'IMG_1.jpg', { type: 'image/jpeg' });

  it('7. 写真を選ぶと /assets → R2 → finalize → POST /environment-spots/:id/photos の順で送り、詳細を取り直す', async () => {
    const calls: { url: string; method: string; body: unknown }[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      calls.push({ url, method, body: typeof init?.body === 'string' ? JSON.parse(init.body) : null });
      if (method === 'GET') return new Response(JSON.stringify({ item: spot }));
      if (url.endsWith('/assets')) return new Response(JSON.stringify({ assetId: 'a-new', assetStatus: 'pending', uploadRequired: true, presignedUploadUrl: 'https://r2.example/put' }));
      if (method === 'PUT') return new Response('', { status: 200 });
      if (url.endsWith('/finalize')) return new Response(JSON.stringify({ assetStatus: 'ready' }));
      return new Response(JSON.stringify({ outcome: 'applied', added: ['a-new'] }));
    });
    const onChanged = vi.fn();
    const { container } = render(<EnvironmentSpotDetailSheet marker={marker} species={SPECIES} pendingObs={[]} idToken="tok" onObserve={vi.fn()} onClose={vi.fn()} onChanged={onChanged} />);
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [jpeg()] } });
    expect(await screen.findByText('写真を 1 枚追加しました')).toBeInTheDocument();
    const posts = calls.filter((c) => c.method !== 'GET').map((c) => `${c.method} ${c.url.replace(/^https:\/\/[^/]+/, '')}`);
    expect(posts).toEqual(['POST /assets', 'PUT /put', 'POST /assets/a-new/finalize', 'POST /environment-spots/s1/photos']);
    const add = calls.find((c) => c.url.endsWith('/photos'))!;
    expect(add.body).toMatchObject({ assetIds: ['a-new'] });
    expect(onChanged).toHaveBeenCalled();
  });

  it('8. 圏外では送らず、端末にも保存しないと伝える', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
      if ((init?.method ?? 'GET') === 'GET') return new Response(JSON.stringify({ item: spot }));
      throw new TypeError('Failed to fetch');
    });
    const { container } = render(<EnvironmentSpotDetailSheet marker={marker} species={SPECIES} pendingObs={[]} idToken="tok" onObserve={vi.fn()} onClose={vi.fn()} />);
    fireEvent.change(container.querySelector('input[type="file"]') as HTMLInputElement, { target: { files: [jpeg()] } });
    expect(await screen.findByText(/写真の追加は電波のある所で/)).toBeInTheDocument();
  });

  it('9. 無効化されたスポット・10 枚あるスポットには「写真を追加」を出さない', () => {
    const archived = { ...marker, remote: { ...spot, status: 'archived' } } as SpotMarker;
    const { unmount } = render(<EnvironmentSpotDetailSheet marker={archived} species={SPECIES} pendingObs={[]} idToken={null} onObserve={vi.fn()} onClose={vi.fn()} />);
    expect(screen.queryByText('写真を追加')).toBeNull();
    unmount();
    const full = { ...marker, remote: { ...spot, photos: Array.from({ length: 10 }, (_, i) => ({ assetId: `a${i}`, thumbnailUrl: null, detailUrl: null })) } } as unknown as SpotMarker;
    render(<EnvironmentSpotDetailSheet marker={full} species={SPECIES} pendingObs={[]} idToken={null} onObserve={vi.fn()} onClose={vi.fn()} />);
    expect(screen.queryByText('写真を追加')).toBeNull();
  });
});
