import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import EnvironmentHubScreen from '../src/screens/EnvironmentHubScreen';
import ExplorationHistoryPanel from '../src/components/terrain/ExplorationHistoryPanel';
import { closeExplorationStoreForTest, getPending, updatePending } from '../src/exploration/pendingStore';

// 「🌲 環境を記録」: 山で木を送る（Field Log 🌲 環境）／帰宅後 YAMAP の GPX を登録（端末に保存 → 地形探索の記録タブで入力を開く）

const gpx = () => new TextEncoder().encode(
  `<?xml version='1.0' encoding='UTF-8'?><gpx creator="YAMAP - https://yamap.com" version="1.1"><trk><name>ウォーキング</name><trkseg>` +
  `<trkpt lat="43.15" lon="140.95"><ele>300</ele><time>2026-10-05T23:30:00Z</time></trkpt><trkpt lat="43.151" lon="140.95"><ele>310</ele><time>2026-10-05T23:31:00Z</time></trkpt>` +
  `</trkseg></trk></gpx>`,
);
const gpxFile = () => new File([gpx()], 'yamap_2026-10-06.gpx', { type: 'application/gpx+xml' });

afterEach(async () => { vi.restoreAllMocks(); await closeExplorationStoreForTest(); indexedDB.deleteDatabase('icarus-exploration'); });

describe('EnvironmentHubScreen', () => {
  it('1. 「木・倒木・地形を送る」は Field Log を 🌲 環境 で開く', () => {
    const go = vi.fn();
    render(<EnvironmentHubScreen go={go} />);
    fireEvent.click(screen.getByRole('button', { name: /木・倒木・地形を送る/ }));
    expect(go).toHaveBeenCalledWith({ name: 'foodLog', subjectType: '環境' });
  });

  it('2. YAMAP の GPX を選ぶと、通信せず端末に下書きとして保存し、地形探索でその入力を開く', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const go = vi.fn();
    render(<EnvironmentHubScreen go={go} />);
    fireEvent.change(screen.getByLabelText('YAMAP の GPX ファイル'), { target: { files: [gpxFile()] } });
    await waitFor(() => expect(go).toHaveBeenCalled());
    const arg = go.mock.calls[0][0] as { name: string; openGpxDraftId: string };
    expect(arg).toMatchObject({ name: 'zukanFieldMap', from: { name: 'environmentHub' } });
    expect((await getPending(arg.openGpxDraftId))).toMatchObject({ ready: false, stage: 'saved', fileName: 'yamap_2026-10-06.gpx' });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('3. GPX でないものは保存せず、理由を出す', async () => {
    const go = vi.fn();
    render(<EnvironmentHubScreen go={go} />);
    fireEvent.change(screen.getByLabelText('YAMAP の GPX ファイル'), { target: { files: [new File(['hello'], 'memo.txt', { type: 'text/plain' })] } });
    expect(await screen.findByText(/保存していません/)).toBeInTheDocument();
    expect(go).not.toHaveBeenCalled();
  });

  it('4. すでに送信済み・入力済みの GPX は 2 件目を作らず知らせる', async () => {
    const go = vi.fn();
    const { unmount } = render(<EnvironmentHubScreen go={go} />);
    fireEvent.change(screen.getByLabelText('YAMAP の GPX ファイル'), { target: { files: [gpxFile()] } });
    await waitFor(() => expect(go).toHaveBeenCalledTimes(1));
    const id = (go.mock.calls[0][0] as { openGpxDraftId: string }).openGpxDraftId;
    await updatePending(id, { ready: true });
    unmount();
    const go2 = vi.fn();
    render(<EnvironmentHubScreen go={go2} />);
    fireEvent.change(screen.getByLabelText('YAMAP の GPX ファイル'), { target: { files: [gpxFile()] } });
    expect(await screen.findByText(/2 件目は作りません/)).toBeInTheDocument();
    expect(go2).not.toHaveBeenCalled();
  });
});

describe('ExplorationHistoryPanel: 選んだ GPX の入力を開く', () => {
  it('5. openDraftId の下書きの入力欄を最初から開く', async () => {
    const go = vi.fn();
    render(<EnvironmentHubScreen go={go} />);
    fireEvent.change(screen.getByLabelText('YAMAP の GPX ファイル'), { target: { files: [gpxFile()] } });
    await waitFor(() => expect(go).toHaveBeenCalled());
    const id = (go.mock.calls[0][0] as { openGpxDraftId: string }).openGpxDraftId;
    const rec = (await getPending(id))!;
    const history = { pending: [rec], entries: [], remoteAsOf: null, remoteError: null, refreshLocal: vi.fn(async () => undefined), refreshRemote: vi.fn(async () => undefined), send: vi.fn(async () => undefined) };
    render(<ExplorationHistoryPanel
      history={history as never} staffName="翔大" show onShowChange={vi.fn()} width={50} onWidthChange={vi.fn()}
      purposeFilter="all" onPurposeFilterChange={vi.fn()} period="all" onPeriodChange={vi.fn()} exploredKm2={null} idToken="tok" openDraftId={id} isAdmin={false} onRangePreview={vi.fn()}
    />);
    expect(await screen.findByLabelText('探索の記録を入力')).toBeInTheDocument();
    expect(screen.getByText(/yamap_2026-10-06.gpx/)).toBeInTheDocument();
    expect((screen.getByDisplayValue('翔大'))).toBeInTheDocument();
  });
});
