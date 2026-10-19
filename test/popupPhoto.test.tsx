import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { PhotoZoom, PopupPhoto } from '../src/components/terrain/PopupPhoto';

// 地図の点の小窓に Field Log の写真（縮小版）とメモを出す。押すと大きく

describe('地図の小窓の写真', () => {
  it('縮小版を出し、押すと元の写真の URL で拡大を開く。メモも出す', () => {
    const onZoom = vi.fn();
    render(<PopupPhoto entry={{ foodName: 'ミズナラ', memo: '太さ80cm・位置±5m', thumbnailUrl: 'https://x/t.jpg', photoUrl: 'https://x/o.jpg' }} onZoom={onZoom} />);
    expect(screen.getByText('太さ80cm・位置±5m')).toBeInTheDocument();
    expect(screen.getByAltText('ミズナラ')).toHaveAttribute('src', 'https://x/t.jpg');
    fireEvent.click(screen.getByRole('button', { name: '写真を大きく見る' }));
    expect(onZoom).toHaveBeenCalledWith('https://x/o.jpg');
  });

  it('縮小版が無ければ元の写真。期限切れなら出さずに知らせる。写真もメモも無ければ何も出さない', () => {
    const { rerender, container } = render(<PopupPhoto entry={{ foodName: 'a', memo: '', photoUrl: 'https://x/o.jpg' }} onZoom={() => {}} />);
    expect(screen.getByRole('img')).toHaveAttribute('src', 'https://x/o.jpg');
    rerender(<PopupPhoto entry={{ foodName: 'a', memo: '', photoUrl: 'https://x/o.jpg', imageExpired: true }} onZoom={() => {}} />);
    expect(screen.queryByRole('img')).toBeNull();
    expect(screen.getByText(/写真は再取得待ち/)).toBeInTheDocument();
    rerender(<PopupPhoto entry={{ foodName: 'a', memo: '', photoUrl: '' }} onZoom={() => {}} />);
    expect(container.textContent).toBe('');
  });

  it('拡大は 押す・× ・Esc で閉じる', () => {
    const onClose = vi.fn();
    render(<PhotoZoom url="https://x/o.jpg" onClose={onClose} />);
    expect(screen.getByAltText('拡大した写真')).toHaveAttribute('src', 'https://x/o.jpg');
    fireEvent.click(screen.getByRole('button', { name: '閉じる' }));
    fireEvent.keyDown(window, { key: 'Escape' });
    fireEvent.click(screen.getByRole('dialog', { name: '写真を拡大' }));
    expect(onClose.mock.calls.length).toBeGreaterThanOrEqual(3);
  });
});
