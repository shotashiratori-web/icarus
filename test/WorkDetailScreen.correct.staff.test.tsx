import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import WorkDetailScreen from '../src/screens/WorkDetailScreen';
import { mockUseAuth } from './testAuth';
import type { WorkDetail } from '../src/types/workLog';

// Work Log Staff Correction（2026-09-27）。active staff は自分・他人を問わず「訂正」でき、訂正履歴を見られる。
// 無効化は admin だけ（staff には出さない）。サーバーの Correction 契約は変えていない

vi.mock('../src/context/AuthContext', () => ({
  useAuth: () => mockUseAuth({
    staffMe: { email: 'staff@test.invalid', displayName: 'Test Staff', role: 'staff', staffStatus: 'active' },
  }),
}));

const api = vi.hoisted(() => ({ fetchWorkDetail: vi.fn(), correctWorkEntry: vi.fn(), fetchWorkEntryCorrections: vi.fn() }));
vi.mock('../src/api/workApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/api/workApi')>()),
  fetchWorkDetail: api.fetchWorkDetail,
  correctWorkEntry: api.correctWorkEntry,
}));
vi.mock('../src/api/workCorrectionsApi', () => ({ fetchWorkEntryCorrections: api.fetchWorkEntryCorrections }));

function workDetail(): WorkDetail {
  return {
    workId: 'w1', title: '仕込み', type: '加工研究', startDate: '2026-07-01T09:00', lastUpdated: '2026-07-01T09:00',
    photoUrl: '', photos: [],
    entries: [{ datetime: '2026-07-01T09:00', content: '内容A', photoUrl: '', caption: '', sheetRow: 2 }],
  };
}

describe('WorkDetailScreen: 一般 staff の訂正', () => {
  beforeEach(() => {
    api.fetchWorkDetail.mockReset().mockResolvedValue(workDetail());
    api.correctWorkEntry.mockReset();
    api.fetchWorkEntryCorrections.mockReset().mockResolvedValue([]);
  });

  it('10. 一般staffにも「訂正」「訂正履歴」が表示され、「無効化」は表示されない', async () => {
    render(<WorkDetailScreen go={vi.fn()} workId="w1" />);
    await screen.findByText('内容A');
    expect(screen.getByText('訂正')).toBeInTheDocument();
    expect(screen.getByText('訂正履歴')).toBeInTheDocument();
    expect(screen.queryByText('この記録を無効化')).not.toBeInTheDocument();
  });

  it('11. staff が訂正すると、編集開始時の値を expected として送る。「変更する項目」を表示する', async () => {
    api.correctWorkEntry.mockResolvedValue({ status: 'success', content: '内容A（訂正）', caption: '' });
    render(<WorkDetailScreen go={vi.fn()} workId="w1" />);
    await screen.findByText('内容A');
    fireEvent.click(screen.getByText('訂正'));
    expect(screen.getByRole('button', { name: '変更なし（閉じる）' })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('本文'), { target: { value: '内容A（訂正）' } });
    expect(screen.getByText('変更する項目: 本文')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() => expect(screen.getByText('内容A（訂正）')).toBeInTheDocument());
    expect(api.correctWorkEntry).toHaveBeenCalledWith('w1', 2, '内容A（訂正）', '', '内容A', '', '', 'test-token');
  });

  it('12. 変更したままキャンセルすると「保存されていない変更があります」→ 破棄で閉じる', async () => {
    render(<WorkDetailScreen go={vi.fn()} workId="w1" />);
    await screen.findByText('内容A');
    fireEvent.click(screen.getByText('訂正'));
    fireEvent.change(screen.getByLabelText('本文'), { target: { value: 'x' } });
    fireEvent.click(screen.getByRole('button', { name: 'キャンセル' }));
    expect(screen.getByText('保存されていない変更があります')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '変更を破棄する' }));
    expect(screen.queryByLabelText('本文')).not.toBeInTheDocument();
    expect(screen.getByText('内容A')).toBeInTheDocument();
    expect(api.correctWorkEntry).not.toHaveBeenCalled();
  });

  it('13. 訂正履歴を新しい順に、誰が・訂正・本文：変更前 → 変更後・注記で表示（変わっていない項目は出さない）', async () => {
    api.fetchWorkEntryCorrections.mockResolvedValue([
      { correctedAt: '2026-09-14T06:31:11.575Z', correctedByName: '翔大', oldContent: '元', oldCaption: '', newContent: '一回目', newCaption: '', note: '誤字' },
      { correctedAt: '2026-09-27T03:00:00.000Z', correctedByName: 'さくし２', oldContent: '一回目', oldCaption: '', newContent: '一回目', newCaption: '写真の説明', note: '' },
    ]);
    render(<WorkDetailScreen go={vi.fn()} workId="w1" />);
    await screen.findByText('内容A');
    fireEvent.click(screen.getByText('訂正履歴'));
    await screen.findByText(/さくし２/);
    const items = screen.getAllByRole('listitem').filter((li) => li.querySelector('ul'));
    expect(items[0]).toHaveTextContent('さくし２・訂正');
    expect(items[0]).toHaveTextContent('キャプション（空欄） → 写真の説明');
    expect(items[0]).not.toHaveTextContent('本文');
    expect(items[1]).toHaveTextContent('翔大・訂正');
    expect(items[1]).toHaveTextContent('誤字');
    expect(items[1]).toHaveTextContent('本文元 → 一回目');
    expect(api.fetchWorkEntryCorrections).toHaveBeenCalledWith('w1', 2, 'test-token');
  });
});
