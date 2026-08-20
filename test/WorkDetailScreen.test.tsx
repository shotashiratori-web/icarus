import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import WorkDetailScreen from '../src/screens/WorkDetailScreen';
import { mockUseAuth } from './testAuth';
import type { WorkDetail } from '../src/types/workLog';

vi.mock('../src/context/AuthContext', () => ({ useAuth: () => mockUseAuth() }));

const { fetchWorkDetail } = vi.hoisted(() => ({ fetchWorkDetail: vi.fn() }));
vi.mock('../src/api/workApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/api/workApi')>();
  return { ...actual, fetchWorkDetail };
});

function workDetail(overrides: Partial<WorkDetail> = {}): WorkDetail {
  return {
    workId: 'w1',
    title: '仕込み',
    type: '加工研究',
    startDate: '2026-07-01T09:00',
    lastUpdated: '2026-07-01T09:00',
    photoUrl: '',
    photos: [
      { datetime: '2026-07-01T09:00', photoUrl: 'https://example.test/1.jpg', caption: '仕込み開始' },
      { datetime: '2026-07-02T09:00', photoUrl: 'https://example.test/2.jpg', caption: '' },
      { datetime: '2026-07-03T09:00', photoUrl: 'https://example.test/3.jpg', caption: '完成' },
    ],
    entries: [],
    ...overrides,
  };
}

async function renderReady(overrides: Partial<WorkDetail> = {}) {
  fetchWorkDetail.mockResolvedValue(workDetail(overrides));
  render(<WorkDetailScreen go={vi.fn()} workId="w1" />);
  await screen.findByRole('heading', { level: 2, name: /写真/ });
}

// サムネイル/Lightbox内のimgはalt=""（装飾扱い）のためrole="img"では拾えない。src属性で直接探す
function clickThumbByUrl(url: string) {
  const img = document.querySelector<HTMLImageElement>(`img[src="${url}"]`);
  fireEvent.click(img!.closest('button')!);
}

// Work Detail Lightboxの回帰確認（共通component切り出し前は同ファイル内直書きで、
// 専用testが無かった。Food Encyclopedia Detailとの共有化に合わせて最低限のカバレッジを追加する）
describe('WorkDetailScreen Lightbox回帰', () => {
  beforeEach(() => {
    fetchWorkDetail.mockReset();
  });

  it('サムネイルclickでLightboxが開き、該当写真のインデックスが表示される', async () => {
    await renderReady();
    clickThumbByUrl('https://example.test/2.jpg');

    expect(screen.getByText('2 / 3')).toBeInTheDocument();
  });

  it('next/previousでインデックスが移動し、先頭/末尾では反対側のnavが消える', async () => {
    await renderReady();
    clickThumbByUrl('https://example.test/1.jpg');

    expect(screen.getByText('1 / 3')).toBeInTheDocument();
    expect(screen.queryByLabelText('前の写真')).not.toBeInTheDocument();
    expect(screen.getByLabelText('次の写真')).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('次の写真'));
    expect(screen.getByText('2 / 3')).toBeInTheDocument();
    expect(screen.getByLabelText('前の写真')).toBeInTheDocument();
    expect(screen.getByLabelText('次の写真')).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('次の写真'));
    expect(screen.getByText('3 / 3')).toBeInTheDocument();
    expect(screen.queryByLabelText('次の写真')).not.toBeInTheDocument();
  });

  it('Escで閉じる', async () => {
    await renderReady();
    clickThumbByUrl('https://example.test/1.jpg');
    expect(screen.getByText('1 / 3')).toBeInTheDocument();

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByText('1 / 3')).not.toBeInTheDocument();
  });

  it('ArrowLeft/ArrowRightキーで前後移動する', async () => {
    await renderReady();
    clickThumbByUrl('https://example.test/2.jpg');
    expect(screen.getByText('2 / 3')).toBeInTheDocument();

    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(screen.getByText('3 / 3')).toBeInTheDocument();

    fireEvent.keyDown(window, { key: 'ArrowLeft' });
    expect(screen.getByText('2 / 3')).toBeInTheDocument();
  });

  it('captionがある写真ではcaptionが表示され、無ければ表示されない', async () => {
    await renderReady();
    clickThumbByUrl('https://example.test/1.jpg');
    expect(screen.getByText('仕込み開始')).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('次の写真'));
    expect(screen.queryByText('仕込み開始')).not.toBeInTheDocument();
  });
});
