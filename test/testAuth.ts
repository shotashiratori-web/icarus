import { vi } from 'vitest';

// component testでは実際のGoogle OAuthフローを通さない。
// authState='ready'固定のuseAuthモックを各テストファイルで共有する
export function mockUseAuth() {
  return {
    idToken: 'test-token',
    userEmail: 'admin@test.invalid',
    authState: 'ready' as const,
    staffMe: { email: 'admin@test.invalid', displayName: 'Test Admin', role: 'admin' as const, staffStatus: 'active' as const },
    signInContainerRef: () => {},
    handleTokenExpired: vi.fn(),
    signOut: vi.fn(),
  };
}
