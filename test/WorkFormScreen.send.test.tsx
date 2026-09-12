import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import WorkFormScreen from '../src/screens/WorkFormScreen';
import { mockUseAuth } from './testAuth';

// Work Log Submission Framework Final Design ④。send()がsubmitWork直呼びから
// submitWithFallback経由へ切り替わったことで生まれる3つのoutcomeを検証する。
// - success: 即時成功。workIdがあれば「作業詳細を見る」を出す
// - queued: retryable失敗。保存して先へ進める体験（詳細/追記は出さない）
// - blocked: non-retryable失敗。従来のerror画面と同じくその場で対処を促す
// submitWithFallback自体はmockし、adapter/localDBの実装には踏み込まない
// （adapter単体の契約はworkLogAdapter.test.tsで別途検証済み）

vi.mock('../src/context/AuthContext', () => ({ useAuth: () => mockUseAuth() }));

const { saveWorkLogDraft, loadWorkLogDraft, clearWorkLogDraft } = vi.hoisted(() => ({
  saveWorkLogDraft: vi.fn(),
  loadWorkLogDraft: vi.fn(),
  clearWorkLogDraft: vi.fn(),
}));
vi.mock('../src/db/localDB', () => ({ saveWorkLogDraft, loadWorkLogDraft, clearWorkLogDraft }));

const { submitWithFallback } = vi.hoisted(() => ({ submitWithFallback: vi.fn() }));
vi.mock('../src/submission/orchestrator', () => ({ submitWithFallback }));

async function fillAndGoToConfirm() {
  fireEvent.change(screen.getByPlaceholderText('例: 山ぶどう酵母起こし'), { target: { value: 'テスト作業' } });
  fireEvent.change(screen.getByRole('combobox'), { target: { value: '加工研究' } });
  fireEvent.change(screen.getByPlaceholderText('観察・作業内容など'), { target: { value: '内容テキスト' } });
  fireEvent.click(await screen.findByRole('button', { name: '確認へ →' }));
  fireEvent.click(await screen.findByRole('button', { name: '送信する' }));
}

describe('WorkFormScreen: send()のoutcome分岐', () => {
  beforeEach(() => {
    saveWorkLogDraft.mockReset().mockResolvedValue(undefined);
    loadWorkLogDraft.mockReset().mockResolvedValue(undefined);
    clearWorkLogDraft.mockReset().mockResolvedValue(undefined);
    submitWithFallback.mockReset();
  });

  it('success: workIdがあれば「作業詳細を見る」を表示する', async () => {
    submitWithFallback.mockResolvedValue({
      ok: true, result: { status: 'success', workId: '20260912-001', row: 2, photoUrl: '' },
    });
    render(<WorkFormScreen go={vi.fn()} mode="create" />);
    await fillAndGoToConfirm();

    expect(await screen.findByText('送信完了')).toBeInTheDocument();
    expect(screen.getByText('作業詳細を見る')).toBeInTheDocument();
    expect(submitWithFallback).toHaveBeenCalledWith(expect.objectContaining({ entity: 'workLog' }));
  });

  it('queued（retryable失敗）: 「作業詳細を見る」「追記」を出さず、続けて記録する/保留中一覧へ/一覧へ戻るを出す', async () => {
    submitWithFallback.mockResolvedValue({
      ok: false,
      item: {
        id: 'req-1', entity: 'workLog', state: 'pending', payload: { requestId: 'req-1' }, title: 'x',
        createdAt: '', updatedAt: '', attempts: 1,
        lastError: {
          code: 'NETWORK_ERROR', title: '', description: '通信できませんでした', retryable: true,
          timestamp: '', entity: 'workLog', payloadId: 'req-1',
        },
      },
    });
    render(<WorkFormScreen go={vi.fn()} mode="create" />);
    await fillAndGoToConfirm();

    expect(await screen.findByText('保存しました')).toBeInTheDocument();
    expect(screen.getByText(/この端末に保存しました/)).toBeInTheDocument();
    expect(screen.queryByText('作業詳細を見る')).not.toBeInTheDocument();
    expect(screen.getByText('新しい作業を記録する')).toBeInTheDocument();
    expect(screen.getByText('保留中一覧へ')).toBeInTheDocument();
  });

  it('blocked（non-retryable失敗）: 再送する/内容を修正する/一覧へ戻るを出す（保存待ち表示にはしない）', async () => {
    submitWithFallback.mockResolvedValue({
      ok: false,
      item: {
        id: 'req-1', entity: 'workLog', state: 'pending', payload: { requestId: 'req-1' }, title: 'x',
        createdAt: '', updatedAt: '', attempts: 1,
        lastError: {
          code: 'SERVER_ERROR', title: '', description: '内容を確認してから再送してください。自動では再送されません。',
          retryable: false, timestamp: '', entity: 'workLog', payloadId: 'req-1',
          technicalDetail: '作業IDが見つかりません: 20260101-999',
        },
      },
    });
    render(<WorkFormScreen go={vi.fn()} mode="create" />);
    await fillAndGoToConfirm();

    expect(await screen.findByText('送信できませんでした')).toBeInTheDocument();
    expect(screen.getByText('作業IDが見つかりません: 20260101-999')).toBeInTheDocument();
    expect(screen.getByText('再送する')).toBeInTheDocument();
    expect(screen.getByText('内容を修正する')).toBeInTheDocument();
    expect(screen.queryByText('この端末に保存しました')).not.toBeInTheDocument();
  });
});
