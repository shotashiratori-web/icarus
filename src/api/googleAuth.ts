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

interface GoogleOAuth2TokenClient {
  requestAccessToken: () => void;
}

interface GoogleOAuth2Api {
  initTokenClient: (config: {
    client_id: string;
    scope: string;
    callback: (res: { access_token?: string }) => void;
    error_callback?: (err: { type?: string }) => void;
  }) => GoogleOAuth2TokenClient;
}

function getGoogleId(): GoogleIdApi | undefined {
  const w = window as unknown as { google?: { accounts: { id: GoogleIdApi } } };
  return w.google?.accounts.id;
}

function getGoogleOAuth2(): GoogleOAuth2Api | undefined {
  const w = window as unknown as { google?: { accounts: { oauth2: GoogleOAuth2Api } } };
  return w.google?.accounts.oauth2;
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
    // requestSilentIdToken()と同様にitp_support: trueを渡す。これが無いと、Safari等の
    // ITP（サードパーティCookieブロック）環境でボタンをタップした際にGoogle側の状態確立が
    // 崩れ、accounts.google.comへ丸ごと遷移した末に白紙表示になる不具合を確認したため。
    itp_support: true,
  });
  googleId.renderButton(el, {
    type: 'standard', text: 'signin_with', size: 'large', locale: 'ja', width: 240,
  });
}

// iOS（WebKitのITP制限）専用経路。google.accounts.idのボタン方式（renderSignInButton）は
// itp_support有無に関わらずこの環境で壊れることを実機Gateで確認済みのため、別のGoogleライブラリ
// （google.accounts.oauth2）によるpopup方式へ切り替える。詳細: icarus_oauth2_popup_login_audit.md
//
// scopeはemail取得に必要な最小限（openid email profile）のみ。Google APIをユーザーに代わって
// 呼び出す用途では使わない
const OAUTH2_SCOPE = 'openid email profile';

/** iOS専用のGoogleサインインボタンを描画する。access tokenをonAccessTokenへ渡す（値の保存はしない）。 */
export async function renderOAuth2SignInButton(
  el: HTMLElement,
  onAccessToken: (accessToken: string) => void,
): Promise<void> {
  await loadGsiScript();
  const oauth2 = getGoogleOAuth2();
  if (!oauth2) return;

  el.innerHTML = '';
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = 'Googleでサインイン';
  Object.assign(button.style, {
    width: '240px',
    height: '40px',
    fontSize: '14px',
    fontFamily: 'Roboto, arial, sans-serif',
    color: '#3c4043',
    background: '#fff',
    border: '1px solid #dadce0',
    borderRadius: '4px',
    cursor: 'pointer',
  });

  const client = oauth2.initTokenClient({
    client_id: GOOGLE_CLIENT_ID,
    scope: OAUTH2_SCOPE,
    callback: (res) => {
      button.disabled = false;
      if (res.access_token) onAccessToken(res.access_token);
    },
    error_callback: () => {
      button.disabled = false;
    },
  });

  button.addEventListener('click', () => {
    button.disabled = true;
    client.requestAccessToken();
  });

  el.appendChild(button);
}
