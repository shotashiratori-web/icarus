import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import WorkDetailScreen from '../src/screens/WorkDetailScreen';
import { mockUseAuth } from './testAuth';
import type { WorkDetail } from '../src/types/workLog';

// Work Log Void v1 Stage Void-B。一般staff（admin以外）には無効化ボタン自体を出さない
// （Final Design合意: v1はadmin限定。ownership情報が無く「自分のentryだけ」の認可を実装できないため）

vi.mock('../src/context/AuthContext', () => ({
  useAuth: () => mockUseAuth({
    staffMe: { email: 'staff@test.invalid', displayName: 'Test Staff', role: 'staff', staffStatus: 'active' },
  }),
}));

const { fetchWorkDetail } = vi.hoisted(() => ({ fetchWorkDetail: vi.fn() }));
vi.mock('../src/api/workApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/api/workApi')>();
  return { ...actual, fetchWorkDetail };
});

function workDetail(): WorkDetail {
  return {
    workId: 'w1', title: '仕込み', type: '加工研究', startDate: '2026-07-01T09:00', lastUpdated: '2026-07-01T09:00',
    photoUrl: '', photos: [],
    entries: [{ datetime: '2026-07-01T09:00', content: '内容A', photoUrl: '', caption: '', sheetRow: 2 }],
  };
}

describe('WorkDetailScreen: Work Log Void v1（一般staff）', () => {
  beforeEach(() => {
    fetchWorkDetail.mockReset().mockResolvedValue(workDetail());
  });

  it('7. 一般staffには「この記録を無効化」ボタンが表示されない', async () => {
    render(<WorkDetailScreen go={vi.fn()} workId="w1" />);
    await screen.findByText('内容A');

    expect(screen.queryByText('この記録を無効化')).not.toBeInTheDocument();
  });
});
