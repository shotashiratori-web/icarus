import { vi } from 'vitest';
import type { StaffMe } from '../src/types/staff';

// component testでは実際のGoogle OAuthフローを通さない。
// authState='ready'固定のuseAuthモックを各テストファイルで共有する。
// overridesでstaffMe等を差し替えられる（例: Work Log Voidのadmin/staff表示分岐テスト）
export function mockUseAuth(overrides: { staffMe?: StaffMe | null } = {}) {
  return {
    idToken: 'test-token',
    userEmail: 'admin@test.invalid',
    authState: 'ready' as const,
    staffMe: { email: 'admin@test.invalid', displayName: 'Test Admin', role: 'admin' as const, staffStatus: 'active' as const },
    signInContainerRef: () => {},
    handleTokenExpired: vi.fn(),
    signOut: vi.fn(),
    ...overrides,
  };
}
