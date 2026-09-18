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
    error_callback?: (err: { type?: string; message?: string }) => void;
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

// 2026-09-18: 別スタッフ（Gate検証を行った本人とは別端末）から「ボタンを押すと真っ白になる」報告。
// Google公式によれば、requestAccessToken()のポップアップが開けない/閉じられた場合は
// error_callbackが type: 'popup_failed_to_open' | 'popup_closed' | 'unknown' 付きで呼ばれる契約
// だが、この情報を画面に一切出していなかったため、何が起きているか一切分からなかった。
// 原因を断定できるまでは推測で直さず、次に同じ事象が起きた際にGoogle側が何を報告しているかが
// スクリーンショット1枚で分かるよう、ボタン直下に状態・エラー内容を表示するようにする
// （PR #36の起動時エラー表示と同じ考え方）。8秒経っても応答が無い場合もその旨を表示する
const OAUTH2_STATUS_TIMEOUT_MS = 8000;

/**
 * iOS専用のGoogleサインインボタンを描画する。access tokenをonAccessTokenへ渡す（値の保存はしない）。
 * onAccessTokenはWorkerとのsession交換結果を { ok, detail? } で返す契約にし（2026-09-19、
 * icarus_oauth2_popup_login_audit.md参照）、失敗時はHTTPステータス等の診断情報をボタン直下へ表示する。
 */
export async function renderOAuth2SignInButton(
  el: HTMLElement,
  onAccessToken: (accessToken: string) => Promise<{ ok: boolean; detail?: string }>,
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

  const status = document.createElement('p');
  Object.assign(status.style, {
    fontSize: '12px',
    color: '#c0392b',
    marginTop: '8px',
    maxWidth: '280px',
  });

  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  const clearPendingTimeout = () => {
    if (timeoutId) { clearTimeout(timeoutId); timeoutId = null; }
  };

  const client = oauth2.initTokenClient({
    client_id: GOOGLE_CLIENT_ID,
    scope: OAUTH2_SCOPE,
    callback: (res) => {
      clearPendingTimeout();
      if (res.access_token) {
        status.textContent = 'サインイン処理中…';
        void onAccessToken(res.access_token).then((result) => {
          button.disabled = false;
          status.textContent = result.ok
            ? ''
            : `セッション取得に失敗しました${result.detail ? `（${result.detail}）` : ''}`;
        });
      } else {
        button.disabled = false;
        status.textContent = 'サインインに失敗しました（access_tokenを受信できませんでした）';
      }
    },
    error_callback: (err) => {
      clearPendingTimeout();
      button.disabled = false;
      status.textContent = `サインインに失敗しました（${err?.type ?? '不明なエラー'}）`;
    },
  });

  button.addEventListener('click', () => {
    button.disabled = true;
    status.textContent = '';
    clearPendingTimeout();
    timeoutId = setTimeout(() => {
      status.textContent = `${OAUTH2_STATUS_TIMEOUT_MS / 1000}秒経っても応答がありません（ポップアップがブロックされている可能性があります）`;
    }, OAUTH2_STATUS_TIMEOUT_MS);
    client.requestAccessToken();
  });

  el.appendChild(button);
  el.appendChild(status);
}
