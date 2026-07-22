import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { requestSilentIdToken, renderSignInButton, disableAutoSelect } from '../api/googleAuth';
import { exchangeForSession } from '../api/sessionApi';
import { fetchMyStaffStatus } from '../api/staffApi';
import { TokenExpiredError } from '../api/icarusApi';
import type { StaffMe } from '../types/staff';

export type AuthState = 'checking' | 'ready' | 'signedOut';

interface AuthContextValue {
  idToken: string | null; // 実体はWorkerが発行する長期セッショントークン（GoogleのIDトークンそのものではない）
  userEmail: string;
  authState: AuthState;
  staffMe: StaffMe | null;
  signInContainerRef: (el: HTMLDivElement | null) => void;
  handleTokenExpired: () => void;
  signOut: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const SESSION_STORAGE_KEY = 'icarus_session_token';
const NEAR_EXPIRY_MS = 3 * 24 * 60 * 60 * 1000; // 期限まで3日を切ったら裏で先回りして更新する

function base64UrlToString(b64url: string): string {
  const pad = (4 - (b64url.length % 4)) % 4;
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat(pad);
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

function decodeSessionPayload(token: string): { email: string; exp: number } | null {
  try {
    const [payloadB64] = token.split('.');
    if (!payloadB64) return null;
    const payload = JSON.parse(base64UrlToString(payloadB64)) as { email?: unknown; exp?: unknown };
    if (typeof payload.email !== 'string' || typeof payload.exp !== 'number') return null;
    return { email: payload.email, exp: payload.exp };
  } catch {
    return null;
  }
}

function isSessionValid(token: string): boolean {
  const p = decodeSessionPayload(token);
  return !!p && Date.now() < p.exp - 60_000;
}

function isSessionNearExpiry(token: string): boolean {
  const p = decodeSessionPayload(token);
  return !p || p.exp - Date.now() < NEAR_EXPIRY_MS;
}

// セッショントークンは、有効な間はページ再読み込みをまたいで使い回す（毎回Googleへ行かない）。
function saveSession(token: string): void {
  try { localStorage.setItem(SESSION_STORAGE_KEY, token); } catch { /* 保存できなくても致命的ではない */ }
}
function loadStoredSession(): string | null {
  try {
    const token = localStorage.getItem(SESSION_STORAGE_KEY);
    return token && isSessionValid(token) ? token : null;
  } catch {
    return null;
  }
}
function clearStoredSession(): void {
  try { localStorage.removeItem(SESSION_STORAGE_KEY); } catch { /* ignore */ }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [idToken, setIdToken] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState('');
  const [authState, setAuthState] = useState<AuthState>('checking');
  const [signInEl, setSignInEl] = useState<HTMLDivElement | null>(null);
  const [staffMe, setStaffMe] = useState<StaffMe | null>(null);

  const applySession = (token: string) => {
    saveSession(token);
    setIdToken(token);
    setUserEmail(decodeSessionPayload(token)?.email ?? '');
    setAuthState('ready');
  };

  const forceSignedOut = () => {
    clearStoredSession();
    setIdToken(null);
    setUserEmail('');
    setStaffMe(null);
    setAuthState('signedOut');
  };

  // Googleのセッションが生きていれば、無言でIDトークンを取り直し、Workerの長期セッションへ交換する。
  const trySilentSessionRenewal = async (): Promise<boolean> => {
    const googleToken = await requestSilentIdToken();
    if (!googleToken) return false;
    const session = await exchangeForSession(googleToken);
    if (!session) return false;
    applySession(session.sessionToken);
    return true;
  };

  // 起動時：保存済みの有効なセッションがあればそれを使う（再ログイン不要）。期限が近ければ裏で更新する。
  // 保存されたセッションがなければ、Googleサイレントサインイン→セッション交換を試みる。
  useEffect(() => {
    let cancelled = false;
    const stored = loadStoredSession();
    if (stored) {
      applySession(stored);
      if (isSessionNearExpiry(stored)) void trySilentSessionRenewal();
      return;
    }
    trySilentSessionRenewal().then((ok) => {
      if (!cancelled && !ok) setAuthState('signedOut');
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (authState !== 'signedOut' || !signInEl) return;
    void renderSignInButton(signInEl, (googleToken) => {
      void exchangeForSession(googleToken).then((session) => {
        if (session) applySession(session.sessionToken);
        // 交換に失敗した場合（未承認スタッフ等）はsignedOut画面のままになる
      });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authState, signInEl]);

  // セッション期限切れ（401）時、まずサイレント再認証を試みる。それでも取得できない場合のみサインイン画面へ。
  const handleTokenExpired = () => {
    void trySilentSessionRenewal().then((ok) => {
      if (!ok) forceSignedOut();
    });
  };

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
