import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
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
