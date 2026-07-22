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

const TOKEN_STORAGE_KEY = 'icarus_id_token';

function decodePayload(token: string): Record<string, unknown> | null {
  try {
    return JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
  } catch {
    return null;
  }
}

function decodeEmail(token: string): string {
  const payload = decodePayload(token);
  return payload && typeof payload.email === 'string' ? payload.email : '';
}

// expの60秒前をもって切れているとみなす（境界での失敗を避けるための余裕）
function isTokenStillValid(token: string): boolean {
  const payload = decodePayload(token);
  const exp = payload && typeof payload.exp === 'number' ? payload.exp : null;
  if (!exp) return false;
  return Date.now() < exp * 1000 - 60_000;
}

// GoogleのIDトークンはページをリロードするたびにメモリから消えてしまっていた（トークン自体は
// 約1時間有効なのに、保存していないため毎回作り直しになり再ログインが頻発していた）。
// 有効な間はlocalStorageに保存して使い回す。
function saveStoredToken(token: string): void {
  try { localStorage.setItem(TOKEN_STORAGE_KEY, token); } catch { /* 保存できなくても致命的ではない */ }
}
function loadStoredToken(): string | null {
  try {
    const token = localStorage.getItem(TOKEN_STORAGE_KEY);
    return token && isTokenStillValid(token) ? token : null;
  } catch {
    return null;
  }
}
function clearStoredToken(): void {
  try { localStorage.removeItem(TOKEN_STORAGE_KEY); } catch { /* ignore */ }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [idToken, setIdToken] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState('');
  const [authState, setAuthState] = useState<AuthState>('checking');
  const [signInEl, setSignInEl] = useState<HTMLDivElement | null>(null);
  const [staffMe, setStaffMe] = useState<StaffMe | null>(null);

  const applyToken = (token: string) => {
    saveStoredToken(token);
    setIdToken(token);
    setUserEmail(decodeEmail(token));
    setAuthState('ready');
  };

  const forceSignedOut = () => {
    clearStoredToken();
    setIdToken(null);
    setUserEmail('');
    setStaffMe(null);
    setAuthState('signedOut');
  };

  // 起動時：保存済みの有効なトークンがあればそれを使う（再ログイン不要）。なければサイレントサインインを試みる。
  useEffect(() => {
    let cancelled = false;
    const stored = loadStoredToken();
    if (stored) {
      applyToken(stored);
      return;
    }
    requestSilentIdToken().then((token) => {
      if (cancelled) return;
      if (token) applyToken(token);
      else setAuthState('signedOut');
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (authState !== 'signedOut' || !signInEl) return;
    void renderSignInButton(signInEl, applyToken);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authState, signInEl]);

  // トークン期限切れ（401）時、まずサイレント再認証を試みる（Googleのセッションが生きていれば無言で復帰する）。
  // それでも取得できない場合のみ、サインインボタンを出す。
  const handleTokenExpired = () => {
    void requestSilentIdToken().then((token) => {
      if (token) applyToken(token);
      else forceSignedOut();
    });
  };

  // Google IDトークンは約1時間で失効する。有効期限切れで401を待たず、
  // ready中は一定間隔でサイレント更新し、通常利用中に再ログインを求められる頻度を減らす。
  useEffect(() => {
    if (authState !== 'ready') return;
    const REFRESH_INTERVAL_MS = 45 * 60 * 1000; // 45分（トークン寿命約60分より十分前に更新）
    const timer = setInterval(() => {
      void requestSilentIdToken().then((token) => {
        if (token) applyToken(token);
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
    forceSignedOut();
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
