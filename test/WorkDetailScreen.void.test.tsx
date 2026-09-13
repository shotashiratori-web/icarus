import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import WorkDetailScreen from '../src/screens/WorkDetailScreen';
import { mockUseAuth } from './testAuth';
import type { WorkDetail } from '../src/types/workLog';

// Work Log Void v1 Stage Void-B。デフォルトのmockUseAuth()はrole:'admin'固定
// （非admin時にボタンが出ないことはWorkDetailScreen.void.staff.test.tsxで別途検証する——
// vi.mockはファイル単位で1回だけ評価されるため、role切り替えはファイルを分けるのが素直）

vi.mock('../src/context/AuthContext', () => ({ useAuth: () => mockUseAuth() }));

const { fetchWorkDetail, voidWorkEntry } = vi.hoisted(() => ({
  fetchWorkDetail: vi.fn(),
  voidWorkEntry: vi.fn(),
}));
vi.mock('../src/api/workApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/api/workApi')>();
  return { ...actual, fetchWorkDetail, voidWorkEntry };
});

function workDetail(overrides: Partial<WorkDetail> = {}): WorkDetail {
  return {
    workId: 'w1',
    title: '仕込み',
    type: '加工研究',
    startDate: '2026-07-01T09:00',
    lastUpdated: '2026-07-02T09:00',
    photoUrl: '',
    photos: [],
    entries: [
      { datetime: '2026-07-01T09:00', content: '内容A', photoUrl: '', caption: '', sheetRow: 2 },
      { datetime: '2026-07-02T09:00', content: '内容B', photoUrl: '', caption: '', sheetRow: 3 },
    ],
    ...overrides,
  };
}

async function renderReady(overrides: Partial<WorkDetail> = {}) {
  fetchWorkDetail.mockResolvedValue(workDetail(overrides));
  render(<WorkDetailScreen go={vi.fn()} workId="w1" />);
  await screen.findByText('内容A');
}

describe('WorkDetailScreen: Work Log Void v1（admin）', () => {
  beforeEach(() => {
    fetchWorkDetail.mockReset();
    voidWorkEntry.mockReset();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('1. adminには各entryに「この記録を無効化」ボタンが表示される', async () => {
    await renderReady();
    expect(screen.getAllByText('この記録を無効化')).toHaveLength(2);
  });

  it('2. 確認ダイアログでキャンセルするとAPIは呼ばれない', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    await renderReady();

    fireEvent.click(screen.getAllByText('この記録を無効化')[0]);

    expect(voidWorkEntry).not.toHaveBeenCalled();
    expect(screen.getByText('内容A')).toBeInTheDocument(); // entryは残る
  });

  it('3. 確認後、正しいworkId + sheetRowでvoidWorkEntryを呼ぶ', async () => {
    voidWorkEntry.mockResolvedValue({ status: 'success', alreadyVoided: false });
    await renderReady();

    fireEvent.click(screen.getAllByText('この記録を無効化')[0]); // 内容A = sheetRow 2

    await waitFor(() => expect(voidWorkEntry).toHaveBeenCalledWith('w1', 2, '', 'test-token'));
  });

  it('4. 成功後、そのentryだけ即座に一覧から消える（他entryは残る）', async () => {
    voidWorkEntry.mockResolvedValue({ status: 'success', alreadyVoided: false });
    await renderReady();

    fireEvent.click(screen.getAllByText('この記録を無効化')[0]); // 内容Aをvoid

    await waitFor(() => expect(screen.queryByText('内容A')).not.toBeInTheDocument());
    expect(screen.getByText('内容B')).toBeInTheDocument(); // 内容Bは無傷
    expect(screen.getByText('記録 (1)')).toBeInTheDocument();
  });

  it('5. alreadyVoided:trueでも成功として扱い、entryは消える', async () => {
    voidWorkEntry.mockResolvedValue({ status: 'success', alreadyVoided: true });
    await renderReady();

    fireEvent.click(screen.getAllByText('この記録を無効化')[0]);

    await waitFor(() => expect(screen.queryByText('内容A')).not.toBeInTheDocument());
  });

  it('6. APIが失敗した場合、entryは残りエラーメッセージが表示される', async () => {
    voidWorkEntry.mockRejectedValue(new Error('サーバーエラーが発生しました'));
    await renderReady();

    fireEvent.click(screen.getAllByText('この記録を無効化')[0]);

    await waitFor(() => expect(screen.getByText('サーバーエラーが発生しました')).toBeInTheDocument());
    expect(screen.getByText('内容A')).toBeInTheDocument(); // entryは消えない
    expect(screen.getByText('記録 (2)')).toBeInTheDocument();
  });
});
