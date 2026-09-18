import { AUTH_SESSION_URL, AUTH_SESSION_OAUTH2_URL } from '../config';

export interface AuthSession {
  sessionToken: string;
  expiresAt: number;
}

async function exchangeCredentialForSession_(url: string, credential: string): Promise<AuthSession | null> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${credential}` },
    });
  } catch {
    return null;
  }
  if (!res.ok) return null;
  try {
    const json = await res.json() as { status: string; sessionToken?: string; expiresAt?: number };
    if (json.status !== 'success' || typeof json.sessionToken !== 'string' || typeof json.expiresAt !== 'number') {
      return null;
    }
    return { sessionToken: json.sessionToken, expiresAt: json.expiresAt };
  } catch {
    return null;
  }
}

/** Google IDトークンを、Workerが発行する長期セッショントークンへ交換する。承認済みスタッフでなければnull。 */
export async function exchangeForSession(googleIdToken: string): Promise<AuthSession | null> {
  return exchangeCredentialForSession_(AUTH_SESSION_URL, googleIdToken);
}

// 2026-09-19: PR #44後の追加症状（Google認証は完了するが直後に「ログインが切れています」へ戻る、
// 別アカウント選択popupが固まる）の切り分け用。HTTPステータス等の診断情報を返す
// （token/session値そのものは一切含めない）。iOS向けOAuth2経路専用、既存exchangeForSessionは無変更
export interface ExchangeDiagnosticResult {
  ok: boolean;
  session?: AuthSession;
  detail?: string;
}

async function exchangeCredentialForSessionWithDiagnostic_(
  url: string, credential: string,
): Promise<ExchangeDiagnosticResult> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${credential}` },
    });
  } catch {
    return { ok: false, detail: 'ネットワークエラー' };
  }
  if (!res.ok) {
    return { ok: false, detail: `HTTP ${res.status}` };
  }
  try {
    const json = await res.json() as { status: string; sessionToken?: string; expiresAt?: number };
    if (json.status !== 'success' || typeof json.sessionToken !== 'string' || typeof json.expiresAt !== 'number') {
      return { ok: false, detail: `不正な応答（status=${json.status}）` };
    }
    return { ok: true, session: { sessionToken: json.sessionToken, expiresAt: json.expiresAt } };
  } catch {
    return { ok: false, detail: '応答の解析に失敗' };
  }
}

// iOS専用のOAuth2 access token経路。Worker側でGoogleのtokeninfoエンドポイントへ問い合わせて
// 検証する（icarus_oauth2_popup_login_audit.md参照）。レスポンス形状は/auth/sessionと同一
export async function exchangeAccessTokenForSession(accessToken: string): Promise<ExchangeDiagnosticResult> {
  return exchangeCredentialForSessionWithDiagnostic_(AUTH_SESSION_OAUTH2_URL, accessToken);
}
