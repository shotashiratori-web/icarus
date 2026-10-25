import 'fake-indexeddb/auto';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';

// 探索計画の画面（icarus_route_plan_v2_design.md）: 作る帯（点の種類・名前・滞在・順番・保存）と一覧（送る・共有・消す）

const { fetchElevations, putServerRoute, archiveServerRoute, listServerRoutes } = vi.hoisted(() => ({
  fetchElevations: vi.fn(), putServerRoute: vi.fn(), archiveServerRoute: vi.fn(), listServerRoutes: vi.fn(),
}));
vi.mock('../src/terrain/gsiElevation', () => ({ fetchElevations }));
vi.mock('../src/api/routePlansApi', () => ({ putServerRoute, archiveServerRoute, listServerRoutes }));
import { closeRouteStoreForTest, deleteRoute, listRoutes, saveRoute, type RoutePlan, type RoutePoint } from '../src/exploration/routePlan';
import { syncRoutes } from '../src/exploration/routeSync';
import RoutePlanPanel, { RouteEditor } from '../src/components/terrain/RoutePlanPanel';

const P: RoutePoint[] = [{ lat: 43.1, lng: 140.85, kind: 'via' }, { lat: 43.1, lng: 140.855, kind: 'via' }, { lat: 43.1, lng: 140.86, kind: 'candidate', name: '霜M1', setTitle: 'P/M/O', stayMin: 20 }];
const echo = (id: string, body: Record<string, unknown>) => ({ id, ...body, createdByName: '翔大', createdAt: '2026-10-25', updatedAt: null, canEdit: true });
beforeEach(async () => {
  for (const r of await listRoutes()) await deleteRoute(r.id);
  await closeRouteStoreForTest();
  fetchElevations.mockReset().mockImplementation(async (pts: unknown[]) => pts.map((_, i) => 100 + i * 0.5));
  putServerRoute.mockReset().mockImplementation(async (id: string, body: Record<string, unknown>) => echo(id, body));
  archiveServerRoute.mockReset(); listServerRoutes.mockReset();
});

function Harness({ token = 'tok', onSaved = () => {} }: { token?: string | null; onSaved?: (sent: boolean) => void }) {
  const [pts, setPts] = useState<RoutePoint[]>(P);
  const [sel, setSel] = useState<number | null>(null);
  return <RouteEditor points={pts} base={null} sel={sel} idToken={token} onPoints={setPts} onSelect={setSel} onCancel={() => {}} onSaved={onSaved} />;
}

describe('計画を作る帯', () => {
  it('経由点を立ち寄り地点にして名前・メモ・滞在 0 分。順番を入れ替え。保存するとサーバーへ送る', async () => {
    const onSaved = vi.fn();
    render(<Harness onSaved={onSaved} />);
    fireEvent.click(screen.getByText(/^2\. 経由点/));
    fireEvent.change(screen.getByLabelText('点の種類'), { target: { value: 'stop' } });
    fireEvent.change(screen.getByLabelText('点の名前'), { target: { value: '沢を渡る' } });
    fireEvent.change(screen.getByLabelText('点のメモ'), { target: { value: '水量を見る' } });
    fireEvent.change(screen.getByLabelText('滞在時間（分）'), { target: { value: '0' } });
    expect(screen.getByText(/沢を渡る（0分）/)).toBeInTheDocument();
    expect(screen.getByText(/滞在 20分/)).toBeInTheDocument(); // 既存候補の 20 分だけ
    fireEvent.click(screen.getByRole('button', { name: '3 を上へ' }));
    expect(screen.getByText(/^2\. 霜M1/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '保存へ' }));
    await screen.findByText(/↑\d+m/);
    expect(screen.getByText('S → 霜M1 → G 沢を渡る')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('計画の名前'), { target: { value: '10/27 シモフリ' } });
    fireEvent.change(screen.getByLabelText('予定日'), { target: { value: '2026-10-27' } });
    fireEvent.change(screen.getByLabelText('スタート予定時刻'), { target: { value: '09:00' } });
    expect(screen.getByText(/（自動 \d+:\d\d）/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(true));
    const body = putServerRoute.mock.calls[0][1];
    expect(body).toMatchObject({ title: '10/27 シモフリ', plannedDate: '2026-10-27', walkMode: 'forest', startTime: '09:00', returnTime: null });
    expect(body.points.map((p: RoutePoint) => p.kind)).toEqual(['via', 'candidate', 'stop']);
    expect(body.points[2]).toMatchObject({ name: '沢を渡る', memo: '水量を見る', stayMin: 0 });
    const [r] = await listRoutes();
    expect(r.shared).toMatchObject({ createdByName: '翔大', canEdit: true }); expect(r.pendingUpload).toBe(false);
  });

  it('送れない時は端末に「送る途中」で残り、次に開いた時に送られる', async () => {
    putServerRoute.mockRejectedValueOnce(new Error('offline'));
    const onSaved = vi.fn();
    render(<Harness onSaved={onSaved} />);
    fireEvent.click(screen.getByRole('button', { name: '保存へ' }));
    await screen.findByText(/↑\d+m/);
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(false));
    const [pending] = await listRoutes();
    expect(pending.pendingUpload).toBe(true);
    // サーバーの一覧には、送ったばかりの計画が入っている
    listServerRoutes.mockImplementation(async () => [echo(pending.id, putServerRoute.mock.calls[1][1])]);
    await syncRoutes('tok');
    expect(putServerRoute).toHaveBeenCalledTimes(2);
    const [r] = await listRoutes(); expect(r.pendingUpload).toBe(false); expect(r.shared).toBeTruthy();
  });

  it('戻る予定が日没より遅いと警告', async () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: '保存へ' }));
    await screen.findByText(/↑\d+m/);
    fireEvent.change(screen.getByLabelText('予定日'), { target: { value: '2026-10-27' } });
    fireEvent.change(screen.getByLabelText('スタート予定時刻'), { target: { value: '09:00' } });
    fireEvent.change(screen.getByLabelText('戻る予定時刻'), { target: { value: '18:30' } });
    expect(screen.getByText(/が日没（1[56]:\d\d）より遅い/)).toBeInTheDocument();
  });
});

describe('一覧と受け取り', () => {
  const base: RoutePlan = { id: '1', name: 'M系', plannedDate: '2026-10-27', purpose: 'シモフリシメジ', mode: 'road', points: P, elevations: null, createdAt: '', visible: true };
  it('端末だけのルートは「サーバーに送る」。共有の計画は作成者と立ち寄る順', async () => {
    const onChanged = vi.fn();
    await saveRoute(base);
    const { rerender } = render(<RoutePlanPanel routes={[base]} editing={false} idToken="tok" onStartDraw={() => {}} onEdit={() => {}} onChanged={onChanged} onShow={() => {}} />);
    expect(screen.getByText('この端末だけ')).toBeInTheDocument();
    expect(screen.getByText('S → G 霜M1')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'サーバーに送る' }));
    await waitFor(() => expect(putServerRoute).toHaveBeenCalled());
    const shared = { ...base, shared: { createdByName: '翔大', canEdit: false, updatedAt: null } };
    rerender(<RoutePlanPanel routes={[shared]} editing={false} idToken="tok" onStartDraw={() => {}} onEdit={() => {}} onChanged={onChanged} onShow={() => {}} />);
    expect(screen.getByText('共有・翔大')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '直す' })).toBeNull(); // 作った本人でなければ直せない
    expect(screen.queryByRole('button', { name: '消す' })).toBeNull();
  });
  it('開くとサーバーの計画が端末に入り、消えた共有の計画は外れる（端末だけのルートは残る）', async () => {
    await saveRoute({ ...base, id: 'local' });
    await saveRoute({ ...base, id: 'gone', shared: { createdByName: 'a', canEdit: true, updatedAt: null } });
    listServerRoutes.mockResolvedValue([echo('srv', { title: '共有の計画', plannedDate: null, purpose: '', walkMode: 'forest', startTime: null, returnTime: null, points: P, elevations: null })]);
    await syncRoutes('tok');
    expect((await listRoutes()).map((r) => r.id).sort()).toEqual(['local', 'srv']);
  });
});
