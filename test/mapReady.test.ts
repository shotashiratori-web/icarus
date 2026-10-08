import { describe, expect, it, vi } from 'vitest';
import { markReadyOnLoad, whenReady } from '../src/terrain/mapReady';

// 3D の切り替えが、タイルの読み込み中（isStyleLoaded() = false）でも効くこと
function fakeMap() {
  const fns: (() => void)[] = [];
  return { once: (_: 'load', fn: () => void) => { fns.push(fn); }, fire: () => fns.splice(0).forEach((f) => f()) };
}

describe('whenReady', () => {
  it('読み終える前は load を待ち、読み終えた後はすぐ反映する（何度切り替えても）', () => {
    const m = fakeMap();
    markReadyOnLoad(m);
    const a = vi.fn();
    whenReady(m, a);
    expect(a).not.toHaveBeenCalled();
    m.fire();
    expect(a).toHaveBeenCalledTimes(1);
    const b = vi.fn();
    whenReady(m, b); // 2 回目以降は load が来なくても反映
    whenReady(m, b);
    expect(b).toHaveBeenCalledTimes(2);
  });
});
