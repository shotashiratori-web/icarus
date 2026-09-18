import { vi } from 'vitest';
import type { StaffMe } from '../src/types/staff';

type MockAuthOverrides = Partial<{
  idToken: string | null;
  userEmail: string;
  authState: 'checking' | 'ready' | 'signedOut';
  staffMe: StaffMe | null;
  signInContainerRef: (el: HTMLDivElement | null) => void;
  handleTokenExpired: () => void;
  signOut: () => void;
  authDiagnostic: string;
}>;

// component testでは実際のGoogle OAuthフローを通さない。
// authState='ready'固定のuseAuthモックを各テストファイルで共有する。
// overridesでstaffMe・signOut等を差し替えられる（例: Work Log Voidのadmin/staff表示分岐テスト、
// SettingsScreenのサインアウトボタンテスト）
export function mockUseAuth(overrides: MockAuthOverrides = {}) {
  return {
    idToken: 'test-token',
    userEmail: 'admin@test.invalid',
    authState: 'ready' as const,
    staffMe: { email: 'admin@test.invalid', displayName: 'Test Admin', role: 'admin' as const, staffStatus: 'active' as const },
    signInContainerRef: () => {},
    handleTokenExpired: vi.fn(),
    signOut: vi.fn(),
    authDiagnostic: '',
    ...overrides,
  };
}
