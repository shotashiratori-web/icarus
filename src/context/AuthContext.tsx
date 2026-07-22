import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { requestSilentIdToken, renderSignInButton, disableAutoSelect } from '../api/googleAuth';
import { fetchMyStaffStatus } from '../api/staffApi';
import { TokenExpiredError } from '../api/icarusApi';
import type { StaffMe } from '../types/staff';

export type AuthState = 'checking' | 'ready' | 'signedOut';

interface AuthContextValue {
  idToken: string | null;
  userEmail: string;
  authState: AuthState;
  staffMe: StaffMe | null;
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
  const [staffMe, setStaffMe] = useState<StaffMe | null>(null);

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

  // トークン期限切れ（401）時、まずサイレント再認証を試みる（Googleのセッションが生きていれば無言で復帰する）。
  // それでも取得できない場合のみ、サインインボタンを出す。
  const handleTokenExpired = () => {
    void requestSilentIdToken().then((token) => {
      if (token) {
        setIdToken(token);
        setUserEmail(decodeEmail(token));
        setAuthState('ready');
        return;
      }
      setIdToken(null);
      setUserEmail('');
      setStaffMe(null);
      setAuthState('signedOut');
    });
  };

  // Google IDトークンは約1時間で失効する。有効期限切れで401を待たず、
  // ready中は一定間隔でサイレント更新し、通常利用中に再ログインを求められる頻度を減らす。
  useEffect(() => {
    if (authState !== 'ready') return;
    const REFRESH_INTERVAL_MS = 45 * 60 * 1000; // 45分（トークン寿命約60分より十分前に更新）
    const timer = setInterval(() => {
      void requestSilentIdToken().then((token) => {
        if (token) {
          setIdToken(token);
          setUserEmail(decodeEmail(token));
        }
        // 取得できなくても、ここでは強制サインアウトしない（次のAPI呼び出しの401で拾われる）
      });
    }, REFRESH_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [authState]);

  // authState が ready になったら一度だけ自分のスタッフ状態を取得する。
  useEffect(() => {
    if (authState !== 'ready' || !idToken) {
      setStaffMe(null);
      return;
    }
    let cancelled = false;
    fetchMyStaffStatus(idToken).then((item) => {
      if (!cancelled) setStaffMe(item);
    }).catch((e) => {
      if (cancelled) return;
      if (e instanceof TokenExpiredError) {
        handleTokenExpired();
      }
      // それ以外の失敗（ネットワーク等）は staffMe を null のままにする。
      // 通常画面側の signedOut/エラー導線に任せ、ここでは致命的にしない。
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authState, idToken]);

  const signOut = () => {
    disableAutoSelect();
    handleTokenExpired();
  };

  return (
    <AuthContext.Provider
      value={{ idToken, userEmail, authState, staffMe, signInContainerRef: setSignInEl, handleTokenExpired, signOut }}
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
