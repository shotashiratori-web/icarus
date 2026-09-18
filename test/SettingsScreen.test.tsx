import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SettingsScreen from '../src/screens/SettingsScreen';
import { mockUseAuth } from './testAuth';

// Home IA整理 v1（2026-09-14）。HomeScreenの「管理・編集」から移動した機能の入口。
// 表示条件（role gating）はHomeScreenの既存条件をそのまま維持しているかを検証する
// （一般staffには従来どおりadmin限定機能を出さない、未ログイン時は空表示）

const { useAuthMock } = vi.hoisted(() => ({ useAuthMock: vi.fn() }));
vi.mock('../src/context/AuthContext', () => ({ useAuth: () => useAuthMock() }));

describe('SettingsScreen: role gating', () => {
  it('1. staffMeがnullの場合、ツール・管理系ボタンは何も表示されない', () => {
    useAuthMock.mockReturnValue(mockUseAuth({ staffMe: null }));
    render(<SettingsScreen go={vi.fn()} />);

    expect(screen.getByText('ログイン後にご利用いただけます。')).toBeInTheDocument();
    expect(screen.queryByText('Lift Up Daily')).not.toBeInTheDocument();
    expect(screen.queryByText('スタッフ管理')).not.toBeInTheDocument();
  });

  it('2. 一般staff（admin以外）には「ツール」のみ表示され、admin限定機能は表示されない', () => {
    useAuthMock.mockReturnValue(mockUseAuth({
      staffMe: { email: 'staff@test.invalid', displayName: 'Test Staff', role: 'staff', staffStatus: 'active' },
    }));
    render(<SettingsScreen go={vi.fn()} />);

    expect(screen.getByText('ツール')).toBeInTheDocument();
    expect(screen.getByText('Lift Up Daily')).toBeInTheDocument();
    expect(screen.getByText('PC一括写真送信')).toBeInTheDocument();
    // 図鑑（試作版）はHome IA整理 v1-1でHomeの「見る・探す」（図鑑）へ統合済み、Settingsからは削除
    expect(screen.queryByText('図鑑（試作版）')).not.toBeInTheDocument();

    expect(screen.queryByText('管理・メンテナンス')).not.toBeInTheDocument();
    expect(screen.queryByText('加工知識を登録')).not.toBeInTheDocument();
    expect(screen.queryByText('スタッフ管理')).not.toBeInTheDocument();
  });

  it('3. adminには「ツール」と「管理・メンテナンス」両方が表示される', () => {
    useAuthMock.mockReturnValue(mockUseAuth({
      staffMe: { email: 'admin@test.invalid', displayName: 'Test Admin', role: 'admin', staffStatus: 'active' },
    }));
    render(<SettingsScreen go={vi.fn()} />);

    expect(screen.getByText('ツール')).toBeInTheDocument();
    expect(screen.getByText('管理・メンテナンス')).toBeInTheDocument();
    expect(screen.getByText('加工知識を登録')).toBeInTheDocument();
    expect(screen.getByText('Foodを登録・編集')).toBeInTheDocument();
    expect(screen.getByText('スタッフ管理')).toBeInTheDocument();
    expect(screen.getByText('Daily確認')).toBeInTheDocument();
    expect(screen.getByText('スポット管理')).toBeInTheDocument();
    expect(screen.getByText('画像メタデータ調査')).toBeInTheDocument();
    expect(screen.getByText('写真ハッシュ補完')).toBeInTheDocument();
  });
});

describe('SettingsScreen: 遷移', () => {
  it('4. 「← ホーム」クリックでhomeへ遷移する', async () => {
    useAuthMock.mockReturnValue(mockUseAuth());
    const go = vi.fn();
    render(<SettingsScreen go={go} />);

    await userEvent.click(screen.getByText('← ホーム'));
    expect(go).toHaveBeenCalledWith({ name: 'home' });
  });

  it('5. adminの「スタッフ管理」クリックでstaffApproval画面へ遷移する', async () => {
    useAuthMock.mockReturnValue(mockUseAuth({
      staffMe: { email: 'admin@test.invalid', displayName: 'Test Admin', role: 'admin', staffStatus: 'active' },
    }));
    const go = vi.fn();
    render(<SettingsScreen go={go} />);

    await userEvent.click(screen.getByText('スタッフ管理'));
    expect(go).toHaveBeenCalledWith({ name: 'staffApproval' });
  });

  it('6. 一般staffの「Lift Up Daily」クリックでdaily画面へ遷移する', async () => {
    useAuthMock.mockReturnValue(mockUseAuth({
      staffMe: { email: 'staff@test.invalid', displayName: 'Test Staff', role: 'staff', staffStatus: 'active' },
    }));
    const go = vi.fn();
    render(<SettingsScreen go={go} />);

    await userEvent.click(screen.getByText('Lift Up Daily'));
    expect(go).toHaveBeenCalledWith({ name: 'daily' });
  });
});

// 別のGoogleアカウントで試す・端末を共用する等のために、通常のログイン状態からも
// サインアウトできる入口を2026-09-19追加。role非依存（一般staffでも表示される）ことを確認する
describe('SettingsScreen: アカウント', () => {
  it('7. 一般staffにも自分のメールアドレスとサインアウトボタンが表示される', () => {
    useAuthMock.mockReturnValue(mockUseAuth({
      staffMe: { email: 'staff@test.invalid', displayName: 'Test Staff', role: 'staff', staffStatus: 'active' },
    }));
    render(<SettingsScreen go={vi.fn()} />);

    expect(screen.getByText('admin@test.invalid')).toBeInTheDocument(); // mockUseAuthのuserEmail固定値
    expect(screen.getByText('サインアウト')).toBeInTheDocument();
  });

  it('8. サインアウトボタンクリックでsignOutが呼ばれる', async () => {
    const signOut = vi.fn();
    useAuthMock.mockReturnValue(mockUseAuth({ signOut }));
    render(<SettingsScreen go={vi.fn()} />);

    await userEvent.click(screen.getByText('サインアウト'));
    expect(signOut).toHaveBeenCalled();
  });
});
