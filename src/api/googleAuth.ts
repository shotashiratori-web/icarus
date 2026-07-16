import { GOOGLE_CLIENT_ID } from '../config';

interface GoogleIdApi {
  initialize: (config: {
    client_id: string;
    callback: (res: { credential: string }) => void;
    auto_select?: boolean;
    cancel_on_tap_outside?: boolean;
    itp_support?: boolean;
  }) => void;
  renderButton: (el: HTMLElement, config: object) => void;
  prompt: (cb?: (notification: {
    isNotDisplayed: () => boolean;
    isDismissedMoment: () => boolean;
  }) => void) => void;
  disableAutoSelect: () => void;
}

function getGoogleId(): GoogleIdApi | undefined {
  const w = window as unknown as { google?: { accounts: { id: GoogleIdApi } } };
  return w.google?.accounts.id;
}

let scriptLoadPromise: Promise<void> | null = null;

function loadGsiScript(): Promise<void> {
  if (getGoogleId()) return Promise.resolve();
  if (scriptLoadPromise) return scriptLoadPromise;

  scriptLoadPromise = new Promise((resolve, reject) => {
    const scriptId = 'gsi-script';
    const existing = document.getElementById(scriptId);
    if (existing) {
      existing.addEventListener('load', () => resolve(), { once: true });
      return;
    }
    const s = document.createElement('script');
    s.id = scriptId;
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.defer = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Google Sign-Inスクリプトの読み込みに失敗しました'));
    document.body.appendChild(s);
  });

  return scriptLoadPromise;
}

/** セッションが残っていればサイレントにID tokenを取得する。取得できなければnull。 */
export async function requestSilentIdToken(): Promise<string | null> {
  try {
    await loadGsiScript();
  } catch {
    return null;
  }
  const googleId = getGoogleId();
  if (!googleId) return null;

  return new Promise((resolve) => {
    let settled = false;
    const finish = (token: string | null) => {
      if (settled) return;
      settled = true;
      resolve(token);
    };

    googleId.initialize({
      client_id: GOOGLE_CLIENT_ID,
      callback: (res) => finish(res.credential),
      auto_select: true,
      cancel_on_tap_outside: false,
      itp_support: true,
    });

    googleId.prompt((notification) => {
      if (notification.isNotDisplayed() || notification.isDismissedMoment()) {
        finish(null);
      }
    });

    // コールバックが来ない場合の保険（GIS側の通知漏れ対策）
    setTimeout(() => finish(null), 4000);
  });
}

/** 自動サインインを無効化する（サインアウト時）。 */
export function disableAutoSelect(): void {
  getGoogleId()?.disableAutoSelect();
}

/** サインインボタンを描画し、認証済みID tokenをcallbackへ渡す。 */
export async function renderSignInButton(
  el: HTMLElement,
  onToken: (idToken: string) => void,
): Promise<void> {
  await loadGsiScript();
  const googleId = getGoogleId();
  if (!googleId) return;

  googleId.initialize({
    client_id: GOOGLE_CLIENT_ID,
    callback: (res) => onToken(res.credential),
  });
  googleId.renderButton(el, {
    type: 'standard', text: 'signin_with', size: 'large', locale: 'ja', width: 240,
  });
}
