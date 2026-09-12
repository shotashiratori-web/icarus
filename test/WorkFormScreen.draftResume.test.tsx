import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import WorkFormScreen from '../src/screens/WorkFormScreen';
import { mockUseAuth } from './testAuth';
import type { WorkLogDraft } from '../src/db/localDB';

// Draft Identity Fix + 明示的Draft Resume。draftRequestIdは「未送信の下書き」一覧からの
// 「続きを編集」経由でのみ渡される。mode/workIdだけを見た自動復元は行わない
// （同一mode/workIdで複数のpending attemptが同時に存在できる設計と矛盾するため）。

vi.mock('../src/context/AuthContext', () => ({ useAuth: () => mockUseAuth() }));

const { loadWorkLogDraft, saveWorkLogDraft, clearWorkLogDraft } = vi.hoisted(() => ({
  loadWorkLogDraft: vi.fn(),
  saveWorkLogDraft: vi.fn(),
  clearWorkLogDraft: vi.fn(),
}));
vi.mock('../src/db/localDB', () => ({ loadWorkLogDraft, saveWorkLogDraft, clearWorkLogDraft }));

function draft(overrides: Partial<WorkLogDraft> = {}): WorkLogDraft {
  return {
    key: 'work:req-a',
    requestId: 'req-a',
    mode: 'create',
    title: 'Aの下書き',
    type: '加工研究',
    content: 'Aの内容',
    datetime: '2026-09-12T10:00',
    caption: '',
    savedAt: '2026-09-12T10:00:00.000Z',
    ...overrides,
  };
}

describe('WorkFormScreen: draftRequestId', () => {
  beforeEach(() => {
    loadWorkLogDraft.mockReset();
    saveWorkLogDraft.mockReset().mockResolvedValue(undefined);
    clearWorkLogDraft.mockReset().mockResolvedValue(undefined);
  });

  it('draftRequestId指定時は、そのrequestIdのdraftを明示的に読み込んでフォームへ反映する', async () => {
    loadWorkLogDraft.mockResolvedValue(draft());

    render(<WorkFormScreen go={vi.fn()} mode="create" draftRequestId="req-a" />);

    expect(await screen.findByDisplayValue('Aの下書き')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Aの内容')).toBeInTheDocument();
    expect(loadWorkLogDraft).toHaveBeenCalledWith('req-a');
  });

  it('draftRequestId未指定なら、work_log_draftに別のdraftが存在してもloadWorkLogDraftは一切呼ばれず、フォームは空のまま始まる', async () => {
    loadWorkLogDraft.mockResolvedValue(draft({ requestId: 'req-a', title: 'Aの下書き' }));

    render(<WorkFormScreen go={vi.fn()} mode="create" />);

    // 「新しい作業」のタイトル欄が描画されるまで待つ（フォームがmountされたことの確認）
    expect(await screen.findByPlaceholderText('例: 山ぶどう酵母起こし')).toHaveValue('');
    expect(loadWorkLogDraft).not.toHaveBeenCalled();
  });
});
