import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ProcessingScreen from '../src/screens/ProcessingScreen';
import { mockUseAuth } from './testAuth';
import type { WorkLogDraft } from '../src/db/localDB';

// 「未送信の下書き」一覧（Draft Identity Fix + 明示的Draft Resume）。
// work_log_draftに残っている下書きをProcessingScreen上部に表示し、タップすると
// そのrequestIdを明示的に指定してWorkFormScreenを開く（mode/workIdからの自動選択はしない）。

vi.mock('../src/context/AuthContext', () => ({ useAuth: () => mockUseAuth() }));

const { listWorkLogDrafts } = vi.hoisted(() => ({ listWorkLogDrafts: vi.fn() }));
vi.mock('../src/db/localDB', () => ({ listWorkLogDrafts }));

const { searchWorkLogs } = vi.hoisted(() => ({ searchWorkLogs: vi.fn() }));
vi.mock('../src/api/workApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/api/workApi')>();
  return { ...actual, searchWorkLogs };
});

// queueStore.refresh()は内部でqueueDB(→localDBのgetDB)を叩く。ここでは「未送信の下書き」一覧の
// 重複除外ロジック（entity==='workLog' && payload.requestId===draft.requestId）だけを検証したいので、
// 実IndexedDBには触れずqueueDB.listAllをmockする
const { queueListAll } = vi.hoisted(() => ({ queueListAll: vi.fn() }));
vi.mock('../src/submission/queueDB', () => ({
  listAll: queueListAll,
  get: vi.fn(),
  put: vi.fn(),
  remove: vi.fn(),
}));

function draft(overrides: Partial<WorkLogDraft> = {}): WorkLogDraft {
  return {
    key: 'work:req-a', requestId: 'req-a', mode: 'create',
    title: '青唐辛子の乳酸発酵', type: '加工研究', content: 'c',
    datetime: '2026-09-12T05:00', caption: '',
    savedAt: '2026-09-12T05:30:00.000Z',
    ...overrides,
  };
}

describe('ProcessingScreen: 未送信の下書き', () => {
  beforeEach(() => {
    listWorkLogDrafts.mockReset();
    queueListAll.mockReset().mockResolvedValue([]);
    searchWorkLogs.mockReset().mockResolvedValue({
      status: 'success', items: [], totalCount: 0, limit: 20, offset: 0, hasMore: false,
    });
  });

  it('下書きが無ければセクション自体を表示しない', async () => {
    listWorkLogDrafts.mockResolvedValue([]);
    render(<ProcessingScreen go={vi.fn()} />);

    await screen.findByText('最近の作業');
    expect(screen.queryByText(/未送信の下書き/)).not.toBeInTheDocument();
  });

  it('createの下書きをタップすると、そのrequestIdを指定してWorkFormScreen(create)を開く', async () => {
    listWorkLogDrafts.mockResolvedValue([draft()]);
    const go = vi.fn();
    render(<ProcessingScreen go={go} />);

    const item = await screen.findByText('青唐辛子の乳酸発酵');
    fireEvent.click(item.closest('button')!);

    expect(go).toHaveBeenCalledWith({ name: 'workForm', mode: 'create', draftRequestId: 'req-a' });
  });

  it('appendの下書きをタップすると、workIdとrequestIdを指定してWorkFormScreen(append)を開く', async () => {
    listWorkLogDrafts.mockResolvedValue([
      draft({ requestId: 'req-append-1', mode: 'append', workId: '20260912-001', title: undefined }),
    ]);
    const go = vi.fn();
    render(<ProcessingScreen go={go} />);

    const item = await screen.findByText('記録を追加: 20260912-001');
    fireEvent.click(item.closest('button')!);

    expect(go).toHaveBeenCalledWith({
      name: 'workForm', mode: 'append', workId: '20260912-001', draftRequestId: 'req-append-1',
    });
  });

  it('submission_queueに同じrequestIdのworkLog itemが既にある下書きは一覧から除外する（Pending List側だけに表示するため）', async () => {
    listWorkLogDrafts.mockResolvedValue([draft(), draft({ requestId: 'req-b', title: '別の下書きB' })]);
    queueListAll.mockResolvedValue([
      {
        id: 'req-a', entity: 'workLog', state: 'pending',
        payload: { requestId: 'req-a' }, title: 'x',
        createdAt: '2026-09-12T05:30:00.000Z', updatedAt: '2026-09-12T05:30:00.000Z', attempts: 1,
      },
    ]);
    render(<ProcessingScreen go={vi.fn()} />);

    await screen.findByText('別の下書きB');
    expect(screen.queryByText('青唐辛子の乳酸発酵')).not.toBeInTheDocument();
    expect(screen.getByText(/未送信の下書き\s*1件/)).toBeInTheDocument();
  });

  it('queueに載っているのが他entityのitemなら除外しない', async () => {
    listWorkLogDrafts.mockResolvedValue([draft()]);
    queueListAll.mockResolvedValue([
      {
        id: 'req-a', entity: 'foodLog', state: 'pending',
        payload: { requestId: 'req-a' }, title: 'x',
        createdAt: '2026-09-12T05:30:00.000Z', updatedAt: '2026-09-12T05:30:00.000Z', attempts: 1,
      },
    ]);
    render(<ProcessingScreen go={vi.fn()} />);

    await screen.findByText('青唐辛子の乳酸発酵');
  });
});
