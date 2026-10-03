import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { mockUseAuth } from './testAuth';
import { emptyCommonFields, emptyPhotoEntry } from '../src/types/foodLog';

// 回帰修正（2026-10-04）: Web の Field Log 入力で 小分類（植物 → 山菜・野菜・果樹・ハーブ・野草）を選べる。
// Web 移行時に入力欄が抜け、7/7 以降の植物は全部 不明 になっていた。既存マスタの値を使い、API・GAS へ渡す

vi.mock('../src/context/AuthContext', () => ({ useAuth: () => mockUseAuth({ userEmail: 'staff@test.invalid', idToken: null }) }));
const { loadFoodLogDraft } = vi.hoisted(() => ({ loadFoodLogDraft: vi.fn() }));
vi.mock('../src/db/localDB', () => ({ loadFoodLogDraft, saveFoodLogDraft: vi.fn(async () => undefined), clearFoodLogDraft: vi.fn(async () => undefined) }));
vi.mock('../src/api/icarusApi', async (importOriginal) => ({ ...(await importOriginal<object>()), fetchFoodCandidates: vi.fn(async () => []) }));
vi.mock('../src/environmentSpots/store', () => ({ loadSpecies: vi.fn(async () => null) }));
vi.mock('../src/submission/queueDB', () => ({ listAll: vi.fn(async () => []), get: vi.fn(), put: vi.fn(), remove: vi.fn() }));

describe('FoodLogScreen: 小分類', () => {
  it('植物を選ぶと 山菜/野菜/果樹/ハーブ/野草 が選べ、大分類を変えると選び直しになる。キノコには出ない', async () => {
    loadFoodLogDraft.mockResolvedValue({ photos: [{ ...emptyPhotoEntry(), base64: 'AAAA' }], commonFields: emptyCommonFields(), submitMode: 'batch', currentPhotoIndex: 0 });
    const { default: FoodLogScreen } = await import('../src/screens/FoodLogScreen');
    render(<FoodLogScreen go={vi.fn()} />);
    await screen.findByAltText('写真1');
    const large = screen.getAllByRole('combobox')[0];
    fireEvent.change(large, { target: { value: '植物' } });
    const sub = screen.getByLabelText('小分類') as HTMLSelectElement;
    expect([...sub.options].map((o) => o.value)).toEqual(['', '山菜', '野菜', '果樹', 'ハーブ', '野草']);
    fireEvent.change(sub, { target: { value: '山菜' } });
    expect((screen.getByLabelText('小分類') as HTMLSelectElement).value).toBe('山菜');
    fireEvent.change(large, { target: { value: 'キノコ' } });
    expect(screen.queryByLabelText('小分類')).toBeNull();
    fireEvent.change(large, { target: { value: '植物' } });
    expect((screen.getByLabelText('小分類') as HTMLSelectElement).value).toBe('');
  });
});

describe('送信: 小分類を渡す', () => {
  it('D1 経路は subCategory を送り、未選択なら送らない（API の既定 不明）', async () => {
    const bodies: Record<string, unknown>[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_i, init) => {
      bodies.push(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify({ success: true, eventId: 'e', requestId: 'r', photoUrl: '', duplicate: false }));
    });
    const { submitFieldLogD1 } = await import('../src/api/fieldLogD1Api');
    const base = { eventId: 'e', requestId: 'r', date: '2026-05-01', food: 'ギョウジャニンニク', place: '', memo: '', photoUrl: '', largeCategory: '植物' };
    await submitFieldLogD1({ ...base, subCategory: '山菜' }, 'tok');
    await submitFieldLogD1(base, 'tok');
    expect(bodies[0]).toMatchObject({ largeCategory: '植物', subCategory: '山菜' });
    expect('subCategory' in bodies[1]).toBe(false);
    vi.restoreAllMocks();
  });
});

describe('FoodLogScreen: 場所は任意', () => {
  it('大分類だけ選べば、場所が空でも次へ進める', async () => {
    loadFoodLogDraft.mockResolvedValue({ photos: [{ ...emptyPhotoEntry(), base64: 'AAAA' }], commonFields: emptyCommonFields(), submitMode: 'batch', currentPhotoIndex: 0 });
    const { default: FoodLogScreen } = await import('../src/screens/FoodLogScreen');
    render(<FoodLogScreen go={vi.fn()} />);
    await screen.findByAltText('写真1');
    const next = screen.getByRole('button', { name: /写真ごとの入力へ/ });
    expect(next).toBeDisabled();
    fireEvent.change(screen.getAllByRole('combobox')[0], { target: { value: 'キノコ' } });
    expect(next).toBeEnabled();
    expect(screen.queryByText(/未入力: .*場所/)).toBeNull();
  });
});
