import { WINE_TASTING_NOTES_URL, wineTastingNoteByIdUrl } from '../config';
import { TokenExpiredError } from './icarusApi';

export interface WineTastingNoteFieldsInput {
  wineId: string | null;
  tastingDate: string;
  location: string;
  wineNameSnapshot: string;
  producerSnapshot: string;
  vintageSnapshot: string;
  aromaText: string;
  memoText: string;
  glassPrice: string;
  bottlePrice: string;
}

export interface WineTastingNoteItem {
  id: string;
  requestId: string;
  wineId: string | null;
  tastingDate: string;
  location: string;
  wineNameSnapshot: string;
  producerSnapshot: string;
  vintageSnapshot: string;
  aromaText: string;
  memoText: string;
  glassPrice: string;
  bottlePrice: string;
  rawNoteJson: unknown;
  status: 'active' | 'deleted';
  createdAt: string;
  updatedAt: string;
  createdBy: string;
}

interface WineTastingNoteApiResponse {
  status: 'success' | 'error';
  item?: WineTastingNoteItem;
  duplicate?: boolean;
  message?: string;
  code?: string;
}

async function parseWineTastingNoteResponse(res: Response): Promise<WineTastingNoteItem> {
  if (res.status === 401) {
    throw new TokenExpiredError('ログインセッションが切れました。再度ログインしてください。');
  }
  let json: WineTastingNoteApiResponse;
  try {
    json = (await res.json()) as WineTastingNoteApiResponse;
  } catch {
    throw new Error(`サーバーエラー (HTTP ${res.status})`);
  }
  if (json.status !== 'success' || !json.item) {
    throw new Error(json.message || '保存に失敗しました');
  }
  return json.item;
}

// requestIdはWineNote.idをそのまま使う（冪等キー）。同一requestId+同一内容の再送は
// サーバー側（Stage 1A）が200 duplicate:trueで吸収するため、ここでは常にPOSTしてよい
export async function createWineTastingNote(
  input: WineTastingNoteFieldsInput & { requestId: string },
  idToken: string,
): Promise<WineTastingNoteItem> {
  let res: Response;
  try {
    res = await fetch(WINE_TASTING_NOTES_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
      body: JSON.stringify(input),
    });
  } catch {
    throw new Error('ネットワークエラーが発生しました。通信状況を確認してください。');
  }
  return parseWineTastingNoteResponse(res);
}

// 一度サーバーへ作成済み（d1_note_id保持済み）のNoteを再送・編集する経路。
// 同一requestIdへのPOST再送で内容差分409を起こさないための分岐（adapter側で使い分ける）
export async function updateWineTastingNote(
  id: string,
  input: WineTastingNoteFieldsInput,
  idToken: string,
): Promise<WineTastingNoteItem> {
  let res: Response;
  try {
    res = await fetch(wineTastingNoteByIdUrl(id), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
      body: JSON.stringify(input),
    });
  } catch {
    throw new Error('ネットワークエラーが発生しました。通信状況を確認してください。');
  }
  return parseWineTastingNoteResponse(res);
}
