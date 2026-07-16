import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { requestSilentIdToken, renderSignInButton, disableAutoSelect } from '../api/googleAuth';

export type AuthState = 'checking' | 'ready' | 'signedOut';

interface AuthContextValue {
  idToken: string | null;
  userEmail: string;
  authState: AuthState;
  signInContainerRef: (el: HTMLDivElement | null) => void;
  handleTokenExpired: () => void;
  signOut: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function decodeEmail(token: string): string {
  try {
    const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    return typeof payload.email === 'string' ? payload.email : '';
  } catch {
    return '';
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [idToken, setIdToken] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState('');
  const [authState, setAuthState] = useState<AuthState>('checking');
  const [signInEl, setSignInEl] = useState<HTMLDivElement | null>(null);

  // アプリ起動時に一度だけサイレントサインインを試みる。以降、画面遷移では再認証しない。
  useEffect(() => {
    let cancelled = false;
    requestSilentIdToken().then((token) => {
      if (cancelled) return;
      if (token) {
        setIdToken(token);
        setUserEmail(decodeEmail(token));
        setAuthState('ready');
      } else {
        setAuthState('signedOut');
      }
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (authState !== 'signedOut' || !signInEl) return;
    void renderSignInButton(signInEl, (token) => {
      setIdToken(token);
      setUserEmail(decodeEmail(token));
      setAuthState('ready');
    });
  }, [authState, signInEl]);

  // トークン期限切れ（401）時のみ再ログインを要求する。
  const handleTokenExpired = () => {
    setIdToken(null);
    setUserEmail('');
    setAuthState('signedOut');
  };

  const signOut = () => {
    disableAutoSelect();
    handleTokenExpired();
  };

  return (
    <AuthContext.Provider
      value={{ idToken, userEmail, authState, signInContainerRef: setSignInEl, handleTokenExpired, signOut }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
