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

    expect(await screen.findByText('フィールドを記録')).toBeInTheDocument();
    expect(screen.queryByText('最近のフィールド')).not.toBeInTheDocument();
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

    expect(await screen.findByText('フィールドを記録')).toBeInTheDocument();
    expect(screen.queryByText('最近の加工・作業')).not.toBeInTheDocument();
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

// Home IA整理 v1（2026-09-14）。記録する/見る・探す/最近の記録への再編、管理・開発系ボタンの
// 設定画面への移動、ワインを記録の一次アクション化を検証する
describe('HomeScreen: Home IA整理 v1', () => {
  beforeEach(() => {
    requestSilentIdToken.mockReset();
    fetchRecentFieldObservations.mockReset().mockResolvedValue([]);
    fetchRecentWorkLogs.mockReset().mockResolvedValue([]);
    authMock.current = mockUseAuth();
  });

  it('12. 記録するセクションに3つのCTA（フィールド/加工・作業/ワイン）が表示される', async () => {
    render(<HomeScreen go={vi.fn()} />);

    expect(await screen.findByText('記録する')).toBeInTheDocument();
    expect(screen.getByText('フィールドを記録')).toBeInTheDocument();
    expect(screen.getByText('加工・作業を記録')).toBeInTheDocument();
    expect(screen.getByText('ワインを記録')).toBeInTheDocument();
  });

  it('13. 「ワインを記録」クリックで新規ワインノート作成画面へ遷移する', async () => {
    const go = vi.fn();
    render(<HomeScreen go={go} />);

    await userEvent.click(await screen.findByText('ワインを記録'));
    expect(go).toHaveBeenCalledWith({ name: 'record', noteId: null });
  });

  it('14. 見る・探すセクションに図鑑/フィールドマップ/加工・作業/ワインが表示され、正しく遷移する', async () => {
    const go = vi.fn();
    render(<HomeScreen go={go} />);

    expect(await screen.findByText('見る・探す')).toBeInTheDocument();
    expect(screen.getByText('フィールドマップ')).toBeInTheDocument();

    await userEvent.click(screen.getByText('図鑑'));
    expect(go).toHaveBeenCalledWith({ name: 'zukan' });

    await userEvent.click(screen.getByText('加工・作業'));
    expect(go).toHaveBeenCalledWith({ name: 'processing' });

    await userEvent.click(screen.getByText('ワイン'));
    expect(go).toHaveBeenCalledWith({ name: 'list' });
  });

  it('15. 旧「管理・編集」セクションおよび管理・開発系ボタンはHomeにもう表示されない（adminでも）', async () => {
    authMock.current = mockUseAuth({
      staffMe: { email: 'admin@test.invalid', displayName: 'Test Admin', role: 'admin', staffStatus: 'active' },
    });
    render(<HomeScreen go={vi.fn()} />);

    await screen.findByText('記録する');
    expect(screen.queryByText('管理・編集')).not.toBeInTheDocument();
    expect(screen.queryByText('加工知識を登録')).not.toBeInTheDocument();
    expect(screen.queryByText('スタッフ管理')).not.toBeInTheDocument();
    expect(screen.queryByText('Lift Up Daily')).not.toBeInTheDocument();
    expect(screen.queryByText('PC一括写真送信')).not.toBeInTheDocument();
  });

  it('16. staffMeがある場合のみヘッダーに「設定」ボタンが表示され、クリックで設定画面へ遷移する', async () => {
    const go = vi.fn();
    render(<HomeScreen go={go} />);

    const settingsBtn = await screen.findByText('設定');
    await userEvent.click(settingsBtn);
    expect(go).toHaveBeenCalledWith({ name: 'settings' });
  });

  it('17. staffMeがnullの場合、ヘッダーに「設定」ボタンは表示されない', async () => {
    authMock.current = mockUseAuth({ staffMe: null });
    render(<HomeScreen go={vi.fn()} />);

    await screen.findByText('記録する');
    expect(screen.queryByText('設定')).not.toBeInTheDocument();
  });

  it('18. 最近のフィールド/最近の加工・作業/最近のワインが「最近の記録」の下に同じ階層で並ぶ', async () => {
    fetchRecentFieldObservations.mockResolvedValue([observation({ food: 'セリ' })]);
    fetchRecentWorkLogs.mockResolvedValue([workLog({ processingName: '塩漬け' })]);
    render(<HomeScreen go={vi.fn()} />);

    expect(await screen.findByText('最近の記録')).toBeInTheDocument();
    expect(screen.getByText('最近のフィールド')).toBeInTheDocument();
    expect(screen.getByText('最近の加工・作業')).toBeInTheDocument();
  });
});
