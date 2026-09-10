import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import HomeScreen from '../src/screens/HomeScreen';
import { mockUseAuth } from './testAuth';
import type { FieldObservation, WorkLogItem } from '../src/types/fieldLog';
import type { AuthState } from '../src/context/AuthContext';

// Home固有の二重認証除去（FedCM/requestSilentIdToken廃止）の検証。
// authState/idTokenはこのモックを各testでvi.mockedして差し替える
type AuthMockValue = Omit<ReturnType<typeof mockUseAuth>, 'authState' | 'idToken'> & {
  authState: AuthState;
  idToken: string | null;
};
const authMock = vi.hoisted(() => ({ current: null as AuthMockValue | null }));
vi.mock('../src/context/AuthContext', () => ({ useAuth: () => authMock.current }));

const { requestSilentIdToken } = vi.hoisted(() => ({ requestSilentIdToken: vi.fn() }));
vi.mock('../src/api/googleAuth', () => ({ requestSilentIdToken }));

const { fetchRecentFieldObservations, fetchRecentWorkLogs } = vi.hoisted(() => ({
  fetchRecentFieldObservations: vi.fn(),
  fetchRecentWorkLogs: vi.fn(),
}));
vi.mock('../src/api/fieldApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/api/fieldApi')>();
  return { ...actual, fetchRecentFieldObservations, fetchRecentWorkLogs };
});

vi.mock('../src/db/localDB', () => ({ getAllNotes: vi.fn().mockResolvedValue([]) }));
vi.mock('../src/submission/queueDB', () => ({
  listAll: vi.fn().mockResolvedValue([]),
  get: vi.fn(),
  put: vi.fn(),
  remove: vi.fn(),
}));

function observation(overrides: Partial<FieldObservation> = {}): FieldObservation {
  return {
    eventId: 'evt-1', date: '2026-08-24', food: 'セリ', place: '畑A', phase: '観察',
    photoUrl: '', notionUrl: '', memo: '', largeCategory: '植物', ...overrides,
  };
}

function workLog(overrides: Partial<WorkLogItem> = {}): WorkLogItem {
  return {
    workId: 'work-1', datetime: '2026-08-24T09:00', processingName: '塩漬け', status: 'done',
    photoUrl: '', memo: '', ingredientText: '', ...overrides,
  };
}

describe('HomeScreen: 最近の観察/最近の作業 認証経路', () => {
  beforeEach(() => {
    requestSilentIdToken.mockReset();
    fetchRecentFieldObservations.mockReset().mockResolvedValue([]);
    fetchRecentWorkLogs.mockReset().mockResolvedValue([]);
    authMock.current = mockUseAuth();
  });

  it('1. authStateがready以外なら recent APIを呼ばない', () => {
    authMock.current = { ...mockUseAuth(), authState: 'checking' };
    render(<HomeScreen go={vi.fn()} />);

    expect(fetchRecentFieldObservations).not.toHaveBeenCalled();
    expect(fetchRecentWorkLogs).not.toHaveBeenCalled();
  });

  it('2. idTokenがなければ recent APIを呼ばない', () => {
    authMock.current = { ...mockUseAuth(), idToken: null };
    render(<HomeScreen go={vi.fn()} />);

    expect(fetchRecentFieldObservations).not.toHaveBeenCalled();
    expect(fetchRecentWorkLogs).not.toHaveBeenCalled();
  });

  it('3. ready + idTokenありで、セッショントークンをそのままfield recent取得に使う', async () => {
    fetchRecentFieldObservations.mockResolvedValue([observation({ food: 'マフグ' })]);
    render(<HomeScreen go={vi.fn()} />);

    expect(fetchRecentFieldObservations).toHaveBeenCalledWith('test-token', 3);
    expect(await screen.findByText('マフグ')).toBeInTheDocument();
  });

  it('4. ready + idTokenありで、セッショントークンをそのままwork recent取得に使う', async () => {
    fetchRecentWorkLogs.mockResolvedValue([workLog({ processingName: 'ミント乾燥' })]);
    render(<HomeScreen go={vi.fn()} />);

    expect(fetchRecentWorkLogs).toHaveBeenCalledWith('test-token', 3);
    expect(await screen.findByText('ミント乾燥')).toBeInTheDocument();
  });

  it('5. requestSilentIdToken（Google FedCM）は呼ばれない', async () => {
    fetchRecentFieldObservations.mockResolvedValue([observation()]);
    render(<HomeScreen go={vi.fn()} />);

    await screen.findByText('セリ');
    expect(requestSilentIdToken).not.toHaveBeenCalled();
  });

  it('6. recent API失敗時もHome全体はクラッシュせず、他セクションは表示される', async () => {
    fetchRecentFieldObservations.mockRejectedValue(new Error('network error'));
    fetchRecentWorkLogs.mockRejectedValue(new Error('network error'));
    render(<HomeScreen go={vi.fn()} />);

    expect(await screen.findByText('フィールドログを記録')).toBeInTheDocument();
    expect(screen.queryByText('最近の観察')).not.toBeInTheDocument();
  });
});

// 「最近の作業」ミニリストのタップ可能化（Work Log Staff UX Completion Audit、Home→追記導線の短縮）。
// 既存デザイン（miniList内のflex行）を崩さず、行全体をnative <button>のタップ領域にした
describe('HomeScreen: 最近の作業ミニリストのタップ可能化', () => {
  beforeEach(() => {
    requestSilentIdToken.mockReset();
    fetchRecentFieldObservations.mockReset().mockResolvedValue([]);
    fetchRecentWorkLogs.mockReset().mockResolvedValue([]);
    authMock.current = mockUseAuth();
  });

  it('7. 最近の作業1件をタップすると正しいworkIdでWorkDetailへ遷移する', async () => {
    fetchRecentWorkLogs.mockResolvedValue([workLog({ workId: 'work-42', processingName: '梅干し仕込み' })]);
    const go = vi.fn();
    render(<HomeScreen go={go} />);

    const item = await screen.findByRole('button', { name: /梅干し仕込み/ });
    await userEvent.click(item);
    expect(go).toHaveBeenCalledWith({ name: 'workDetail', workId: 'work-42' });
  });

  it('8. 「もっと見る」は従来通り一覧（processing）へ遷移する', async () => {
    fetchRecentWorkLogs.mockResolvedValue([workLog()]);
    const go = vi.fn();
    render(<HomeScreen go={go} />);

    await screen.findByText('塩漬け');
    await userEvent.click(screen.getByRole('button', { name: 'もっと見る' }));
    expect(go).toHaveBeenCalledWith({ name: 'processing' });
  });

  it('9. 最近の作業が0件でもセクション自体が表示されず、崩れない', async () => {
    fetchRecentWorkLogs.mockResolvedValue([]);
    render(<HomeScreen go={vi.fn()} />);

    expect(await screen.findByText('フィールドログを記録')).toBeInTheDocument();
    expect(screen.queryByText('最近の作業')).not.toBeInTheDocument();
  });

  it('10. photoUrlを持つ項目でも行のタップは正しく動く', async () => {
    fetchRecentWorkLogs.mockResolvedValue([
      workLog({ workId: 'work-99', processingName: '写真付き作業', photoUrl: 'https://example.com/a.jpg' }),
    ]);
    const go = vi.fn();
    render(<HomeScreen go={go} />);

    const item = await screen.findByRole('button', { name: /写真付き作業/ });
    await userEvent.click(item);
    expect(go).toHaveBeenCalledWith({ name: 'workDetail', workId: 'work-99' });
  });

  it('11. 行はネイティブbutton要素で、フォーカス可能（キーボード操作可能）', async () => {
    fetchRecentWorkLogs.mockResolvedValue([workLog({ workId: 'work-7', processingName: 'キーボードテスト' })]);
    render(<HomeScreen go={vi.fn()} />);

    const item = await screen.findByRole('button', { name: /キーボードテスト/ });
    expect(item.tagName).toBe('BUTTON');
    item.focus();
    expect(item).toHaveFocus();
  });
});
