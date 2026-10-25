import 'fake-indexeddb/auto';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

// ルート予定の画面（icarus_route_plan_v1_design.md）: 線の帯（戻す・保存へ・保存）と一覧

const { fetchElevations } = vi.hoisted(() => ({ fetchElevations: vi.fn() }));
vi.mock('../src/terrain/gsiElevation', () => ({ fetchElevations }));
import { closeRouteStoreForTest, deleteRoute, listRoutes } from '../src/exploration/routePlan';
import RoutePlanPanel, { RouteDrawBar } from '../src/components/terrain/RoutePlanPanel';

const P = [{ lat: 43.1, lng: 140.85 }, { lat: 43.1, lng: 140.86 }];
beforeEach(async () => { for (const r of await listRoutes()) await deleteRoute(r.id); await closeRouteStoreForTest(); fetchElevations.mockReset(); });

describe('線を引いている間の帯', () => {
  it('2 点からで保存へ。標高を取り、名前・予定日・目的・歩き方（初期値 山林探索）で保存', async () => {
    fetchElevations.mockImplementation(async (pts: unknown[]) => pts.map((_, i) => 100 + i));
    const onSaved = vi.fn(), onUndo = vi.fn();
    const { rerender } = render(<RouteDrawBar points={P.slice(0, 1)} onUndo={onUndo} onCancel={() => {}} onSaved={onSaved} />);
    expect(screen.getByRole('button', { name: '保存へ' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '1 つ戻す' })); expect(onUndo).toHaveBeenCalled();
    rerender(<RouteDrawBar points={P} onUndo={onUndo} onCancel={() => {}} onSaved={onSaved} />);
    fireEvent.click(screen.getByRole('button', { name: '保存へ' }));
    await screen.findByText(/登り\d+m/);
    expect(screen.getByLabelText('歩き方')).toHaveValue('forest');
    fireEvent.change(screen.getByLabelText('ルートの名前'), { target: { value: 'M系' } });
    fireEvent.change(screen.getByLabelText('予定日'), { target: { value: '2026-10-27' } });
    fireEvent.change(screen.getByLabelText('目的'), { target: { value: 'シモフリシメジ' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    const [r] = await listRoutes();
    expect(r).toMatchObject({ name: 'M系', plannedDate: '2026-10-27', purpose: 'シモフリシメジ', mode: 'forest', points: P, visible: true });
    expect(r.elevations?.length).toBeGreaterThan(50);
  });
  it('標高が取れなくても距離だけで保存できる', async () => {
    fetchElevations.mockRejectedValue(new Error('offline'));
    const onSaved = vi.fn();
    render(<RouteDrawBar points={P} onUndo={() => {}} onCancel={() => {}} onSaved={onSaved} />);
    fireEvent.click(screen.getByRole('button', { name: '保存へ' }));
    expect(await screen.findByText(/標高を取れませんでした/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect((await listRoutes())[0].elevations).toBeNull();
  });
});

describe('一覧', () => {
  it('ルートの距離・予定日・目的を出し、引き始められる', () => {
    const onStart = vi.fn();
    render(<RoutePlanPanel routes={[{ id: '1', name: 'M系', plannedDate: '2026-10-27', purpose: 'シモフリシメジ', mode: 'road', points: P, elevations: null, createdAt: '', visible: true }]} drawing={null} onStartDraw={onStart} onChanged={() => {}} onShow={() => {}} />);
    expect(screen.getByText(/M系/)).toBeInTheDocument();
    expect(screen.getByText(/2026-10-27・シモフリシメジ/)).toBeInTheDocument();
    expect(screen.getByText(/0\.81km・標高は未取得/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'ルートを引く' })); expect(onStart).toHaveBeenCalled();
  });
});
