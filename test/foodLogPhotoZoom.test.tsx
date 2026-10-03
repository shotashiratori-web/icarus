import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { mockUseAuth } from './testAuth';
import { emptyCommonFields, emptyPhotoEntry } from '../src/types/foodLog';

// Field Log 入力: 写真をタップして全画面で確認できる（タップ・×・Esc で閉じる）

vi.mock('../src/context/AuthContext', () => ({ useAuth: () => mockUseAuth({ userEmail: 'staff@test.invalid' }) }));
const { loadFoodLogDraft } = vi.hoisted(() => ({ loadFoodLogDraft: vi.fn() }));
vi.mock('../src/db/localDB', () => ({ loadFoodLogDraft, saveFoodLogDraft: vi.fn(async () => undefined), clearFoodLogDraft: vi.fn(async () => undefined) }));
vi.mock('../src/api/icarusApi', async (importOriginal) => ({ ...(await importOriginal<object>()), fetchFoodCandidates: vi.fn(async () => []) }));
vi.mock('../src/environmentSpots/store', () => ({ loadSpecies: vi.fn(async () => null) }));
vi.mock('../src/submission/queueDB', () => ({ listAll: vi.fn(async () => []), get: vi.fn(), put: vi.fn(), remove: vi.fn() }));

describe('FoodLogScreen: 写真の拡大', () => {
  it('写真をタップすると全画面で開き、タップ・× で閉じる', async () => {
    const photo = { ...emptyPhotoEntry(), base64: 'AAAA', food: 'ミズナラ' };
    loadFoodLogDraft.mockResolvedValue({ photos: [photo], commonFields: emptyCommonFields(), submitMode: 'batch', currentPhotoIndex: 0 });
    const { default: FoodLogScreen } = await import('../src/screens/FoodLogScreen');
    render(<FoodLogScreen go={vi.fn()} />);
    const thumb = await screen.findByAltText('写真1');
    expect(screen.getByText(/写真をタップで拡大/)).toBeInTheDocument();
    fireEvent.click(thumb);
    const dialog = screen.getByRole('dialog', { name: '写真を拡大' });
    expect(screen.getByAltText('拡大した写真')).toHaveAttribute('src', 'data:image/jpeg;base64,AAAA');
    fireEvent.click(dialog);
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '写真を拡大' })).toBeNull());
    fireEvent.click(thumb);
    fireEvent.click(screen.getByRole('button', { name: '閉じる' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '写真を拡大' })).toBeNull());
    fireEvent.click(thumb);
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '写真を拡大' })).toBeNull());
  });
});
