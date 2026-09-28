import { describe, expect, it } from 'vitest';
import { displayedSourceLabel, initialPanelOpen, insideBounds, shouldAutoLocate } from '../src/terrain/initialView';

// 地形探索を開いた時の見え方（Terrain Stage 1 Gate の改善 2 件、2026-09-28）

describe('initialView', () => {
  it('1. 保存後の「表示中」: 保存済みの版と表示中の版が同じなら「端末に保存した版」。削除すれば未保存に戻る', () => {
    expect(displayedSourceLabel('20260928-cc275685', '20260928-cc275685')).toBe('端末に保存した版');
    expect(displayedSourceLabel('20260928-cc275685', null)).toBe('取得した版（未保存）');
    expect(displayedSourceLabel('20261001-aaaaaaaa', '20260928-cc275685')).toBe('取得した版（未保存）');
  });

  it('2. スマホ幅では条件パネルを閉じて開く', () => {
    expect(initialPanelOpen(390)).toBe(false);
    expect(initialPanelOpen(600)).toBe(false);
    expect(initialPanelOpen(1280)).toBe(true);
  });

  it('3. 現在地を自動で取るのは、許可済みか前回使っていた時だけ。拒否されていれば取らない', () => {
    expect(shouldAutoLocate('granted', false)).toBe(true);
    expect(shouldAutoLocate('prompt', true)).toBe(true);
    expect(shouldAutoLocate('unknown', true)).toBe(true);
    expect(shouldAutoLocate('prompt', false)).toBe(false);
    expect(shouldAutoLocate('unknown', false)).toBe(false);
    expect(shouldAutoLocate('denied', true)).toBe(false);
  });

  it('4. 範囲の外にいる時は現在地へ寄せない（範囲全体のまま）', () => {
    const b = { south: 43.02, north: 43.26, west: 140.62, east: 141.08 };
    expect(insideBounds(b, 43.13, 140.85)).toBe(true);
    expect(insideBounds(b, 43.06, 141.35)).toBe(false); // 札幌
  });
});
