import { AUTH_SESSION_URL } from '../config';

export interface AuthSession {
  sessionToken: string;
  expiresAt: number;
}

/** Google IDトークンを、Workerが発行する長期セッショントークンへ交換する。承認済みスタッフでなければnull。 */
export async function exchangeForSession(googleIdToken: string): Promise<AuthSession | null> {
  let res: Response;
  try {
    res = await fetch(AUTH_SESSION_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${googleIdToken}` },
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
