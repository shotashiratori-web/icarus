import { describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import { MapContainer } from 'react-leaflet';
import FacingCone, { FACING_ARROW, type ConeElements } from '../src/components/terrain/FacingCone';

// 向いている方向の扇形（Field Navigation v1 PR2）: 現在地に 1 つのマーカーを置き、扇形・文字の要素を渡す。外したら片付ける

describe('FacingCone', () => {
  it('現在地に扇形（60° の SVG）と方位の文字を置き、要素を渡す。外すと null を渡してマーカーを消す', () => {
    const onReady = vi.fn<(el: ConeElements | null) => void>();
    const { container, unmount } = render(
      <MapContainer center={[43.10494, 140.86263]} zoom={15} style={{ width: 300, height: 300 }}>
        <FacingCone pos={[43.10494, 140.86263]} onReady={onReady} />
      </MapContainer>,
    );
    const el = onReady.mock.calls[0][0];
    expect(el).not.toBeNull();
    expect(el!.wedge.querySelector('path')?.getAttribute('d')).toBe('M0 0 L-29 -50 A58 58 0 0 1 29 -50 Z');
    expect(el!.label.textContent).toBe('向きを取得中…');
    // 扇形の中心に「向いている方向の矢印」。扇形と同じ要素の中なので、向きの回転で一緒に回る
    const paths = el!.wedge.querySelectorAll('path');
    expect(paths).toHaveLength(2);
    expect(paths[1].getAttribute('d')).toBe(FACING_ARROW);
    expect(container.querySelectorAll('.leaflet-marker-icon')).toHaveLength(1);
    unmount();
    expect(onReady).toHaveBeenLastCalledWith(null);
  });
});
