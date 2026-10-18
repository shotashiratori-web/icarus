import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { mockUseAuth } from './testAuth';
import { emptyCommonFields, emptyPhotoEntry } from '../src/types/foodLog';

// Field Log 入力: 下書きは 1 文字ごとに書かず、打ち終わってから 1 回だけ書く（2026-10-18: 10 枚で文字を打つと固まった）

vi.mock('../src/context/AuthContext', () => ({ useAuth: () => mockUseAuth({ userEmail: 'staff@test.invalid' }) }));
const { loadFoodLogDraft, saveFoodLogDraft } = vi.hoisted(() => ({ loadFoodLogDraft: vi.fn(), saveFoodLogDraft: vi.fn(async (_draft: unknown) => undefined) }));
vi.mock('../src/db/localDB', () => ({ loadFoodLogDraft, saveFoodLogDraft, clearFoodLogDraft: vi.fn(async () => undefined) }));
vi.mock('../src/api/icarusApi', async (importOriginal) => ({ ...(await importOriginal<object>()), fetchFoodCandidates: vi.fn(async () => []) }));
vi.mock('../src/environmentSpots/store', () => ({ loadSpecies: vi.fn(async () => null) }));
vi.mock('../src/submission/queueDB', () => ({ listAll: vi.fn(async () => []), get: vi.fn(), put: vi.fn(), remove: vi.fn() }));

describe('FoodLogScreen: 下書きの書き方', () => {
  it('続けて打っている間は書かず、止めてから 1 回だけ（最後の内容で）。画面を離れる時は待たずに書く', async () => {
    const photos = Array.from({ length: 10 }, () => ({ ...emptyPhotoEntry(), base64: 'AAAA', food: 'ミズナラ' }));
    loadFoodLogDraft.mockResolvedValue({ photos, commonFields: emptyCommonFields(), submitMode: 'batch', currentPhotoIndex: 0 });
    const { default: FoodLogScreen } = await import('../src/screens/FoodLogScreen');
    const view = render(<FoodLogScreen go={vi.fn()} />);
    await screen.findByAltText('写真1');
    await new Promise((r) => setTimeout(r, 700)); // 復元の直後の 1 回を済ませる
    saveFoodLogDraft.mockClear();

    vi.useFakeTimers();
    const memo = screen.getAllByRole('textbox')[0]; // 写真一覧の画面の最初の入力欄（どの欄でも下書きの対象）
    for (const v of ['太', '太い', '太いミ', '太いミズナラ']) {
      fireEvent.change(memo, { target: { value: v } });
      vi.advanceTimersByTime(200);
    }
    expect(saveFoodLogDraft).not.toHaveBeenCalled();
    vi.advanceTimersByTime(600);
    expect(saveFoodLogDraft).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(saveFoodLogDraft.mock.calls[0][0])).toContain('太いミズナラ');

    fireEvent.change(memo, { target: { value: '太いミズナラ 80' } });
    view.unmount();
    expect(saveFoodLogDraft).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(saveFoodLogDraft.mock.calls[1][0])).toContain('太いミズナラ 80');
    vi.useRealTimers();
  });
});
