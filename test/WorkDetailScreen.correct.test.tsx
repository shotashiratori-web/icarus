import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import WorkDetailScreen from '../src/screens/WorkDetailScreen';
import { mockUseAuth } from './testAuth';
import { WorkCorrectionConflictError } from '../src/api/workApi';
import type { WorkDetail } from '../src/types/workLog';

// Work Log Correction v1 Stage B。デフォルトのmockUseAuth()はrole:'admin'固定
// （非adminには「訂正」ボタン自体を出さない——WorkDetailScreen.correct.staff.test.tsxで別途検証）

vi.mock('../src/context/AuthContext', () => ({ useAuth: () => mockUseAuth() }));

const { fetchWorkDetail, correctWorkEntry } = vi.hoisted(() => ({
  fetchWorkDetail: vi.fn(),
  correctWorkEntry: vi.fn(),
}));
vi.mock('../src/api/workApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/api/workApi')>();
  return { ...actual, fetchWorkDetail, correctWorkEntry };
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
      { datetime: '2026-07-01T09:00', content: '内容A', photoUrl: '', caption: 'caption-a', sheetRow: 2 },
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

describe('WorkDetailScreen: Work Log Correction v1（admin）', () => {
  beforeEach(() => {
    fetchWorkDetail.mockReset();
    correctWorkEntry.mockReset();
  });

  it('1. adminには各entryに「訂正」ボタンが表示される', async () => {
    await renderReady();
    expect(screen.getAllByText('訂正')).toHaveLength(2);
  });

  it('2. 「訂正」クリックで編集フォームが開き、現在のcontent/captionが初期値になる', async () => {
    await renderReady();

    fireEvent.click(screen.getAllByText('訂正')[0]); // 内容A = sheetRow 2

    expect(screen.getByDisplayValue('内容A')).toBeInTheDocument();
    expect(screen.getByDisplayValue('caption-a')).toBeInTheDocument();
    expect(correctWorkEntry).not.toHaveBeenCalled();
  });

  it('3. キャンセルでフォームが閉じ、元の表示に戻る（APIは呼ばれない）', async () => {
    await renderReady();

    fireEvent.click(screen.getAllByText('訂正')[0]);
    fireEvent.click(screen.getByText('キャンセル'));

    expect(screen.queryByDisplayValue('内容A')).not.toBeInTheDocument();
    expect(screen.getByText('内容A')).toBeInTheDocument(); // 静的表示に戻る
    expect(correctWorkEntry).not.toHaveBeenCalled();
  });

  it('4. 保存で正しいworkId・sheetRow・新content/caption・現在値(expected)でcorrectWorkEntryを呼ぶ', async () => {
    correctWorkEntry.mockResolvedValue({ status: 'success', content: '内容A（訂正済み）', caption: 'caption-a' });
    await renderReady();

    fireEvent.click(screen.getAllByText('訂正')[0]); // sheetRow 2, content='内容A', caption='caption-a'
    const textarea = screen.getByDisplayValue('内容A');
    fireEvent.change(textarea, { target: { value: '内容A（訂正済み）' } });
    fireEvent.click(screen.getByText('保存'));

    await waitFor(() => expect(correctWorkEntry).toHaveBeenCalledWith(
      'w1', 2, '内容A（訂正済み）', 'caption-a', '内容A', 'caption-a', '', 'test-token',
    ));
  });

  it('5. 成功後、フォームが閉じてcontent/captionがローカルに反映される（他entryは無傷）', async () => {
    correctWorkEntry.mockResolvedValue({ status: 'success', content: '内容A（訂正済み）', caption: '新キャプション' });
    await renderReady();

    fireEvent.click(screen.getAllByText('訂正')[0]);
    fireEvent.change(screen.getByDisplayValue('内容A'), { target: { value: '内容A（訂正済み）' } });
    fireEvent.click(screen.getByText('保存'));

    await waitFor(() => expect(screen.getByText('内容A（訂正済み）')).toBeInTheDocument());
    expect(screen.getByText('新キャプション')).toBeInTheDocument();
    expect(screen.getByText('内容B')).toBeInTheDocument(); // 他entryは無傷
    expect(screen.queryByDisplayValue('内容A（訂正済み）')).not.toBeInTheDocument(); // フォームは閉じる
  });

  it('6. alreadyCorrected:trueでも成功として扱い、content/captionがローカルへ反映される', async () => {
    correctWorkEntry.mockResolvedValue({ status: 'success', alreadyCorrected: true, content: '内容A（訂正済み）', caption: 'caption-a' });
    await renderReady();

    fireEvent.click(screen.getAllByText('訂正')[0]);
    fireEvent.change(screen.getByDisplayValue('内容A'), { target: { value: '内容A（訂正済み）' } });
    fireEvent.click(screen.getByText('保存'));

    await waitFor(() => expect(screen.getByText('内容A（訂正済み）')).toBeInTheDocument());
  });

  it('7. 409競合（WorkCorrectionConflictError）時は、エラー表示・サーバー最新値をフォームへ反映・フォームは開いたまま', async () => {
    correctWorkEntry.mockRejectedValue(
      new WorkCorrectionConflictError('他の変更と競合しました。最新の内容を確認してください。', '他の人が変更した内容', 'caption-a'),
    );
    await renderReady();

    fireEvent.click(screen.getAllByText('訂正')[0]);
    fireEvent.change(screen.getByDisplayValue('内容A'), { target: { value: '内容A（訂正済み）' } });
    fireEvent.click(screen.getByText('保存'));

    await waitFor(() => expect(screen.getByText(/他の変更と競合しました/)).toBeInTheDocument());
    expect(screen.getByDisplayValue('他の人が変更した内容')).toBeInTheDocument(); // フォームへ最新値が反映
    expect(screen.getByText('保存')).toBeInTheDocument(); // フォームはまだ開いている
  });

  it('8. 一般エラー時はエラーメッセージを表示し、フォームは開いたまま・値は変わらない', async () => {
    correctWorkEntry.mockRejectedValue(new Error('サーバーエラーが発生しました'));
    await renderReady();

    fireEvent.click(screen.getAllByText('訂正')[0]);
    fireEvent.change(screen.getByDisplayValue('内容A'), { target: { value: '内容A（訂正済み）' } });
    fireEvent.click(screen.getByText('保存'));

    await waitFor(() => expect(screen.getByText('サーバーエラーが発生しました')).toBeInTheDocument());
    expect(screen.getByDisplayValue('内容A（訂正済み）')).toBeInTheDocument(); // 編集中の値は保持
  });

  it('9. contentが空文字のときは保存ボタンがdisabledになる', async () => {
    await renderReady();

    fireEvent.click(screen.getAllByText('訂正')[0]);
    fireEvent.change(screen.getByDisplayValue('内容A'), { target: { value: '' } });

    expect(screen.getByText('保存')).toBeDisabled();
  });
});
