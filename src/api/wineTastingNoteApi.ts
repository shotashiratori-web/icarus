import { WINE_TASTING_NOTES_URL, wineTastingNoteByIdUrl, wineTastingNoteAssetsUrl, wineTastingNoteLabelAssetUrl } from '../config';
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

// Stage 1C-B: Wine Detail用の読み取り専用一覧取得。GET /wine-tasting-notesはStage 1Aの実装により
// created_by=auth.emailで常にスコープされる（private ownership）——ここではクライアント側で
// 追加のフィルタは行わない（server側の保証に任せる）。orderingもserver契約（updated_at DESC）のまま使う
export async function fetchWineTastingNotesByWine(wineId: string, idToken: string): Promise<WineTastingNoteItem[]> {
  let res: Response;
  try {
    res = await fetch(`${WINE_TASTING_NOTES_URL}?wineId=${encodeURIComponent(wineId)}`, {
      headers: { Authorization: `Bearer ${idToken}` },
    });
  } catch {
    throw new Error('ネットワークエラーが発生しました。通信状況を確認してください。');
  }
  if (res.status === 401) {
    throw new TokenExpiredError('ログインセッションが切れました。再度ログインしてください。');
  }
  let json: { status: 'success' | 'error'; items?: WineTastingNoteItem[]; message?: string };
  try {
    json = await res.json();
  } catch {
    throw new Error(`サーバーエラー (HTTP ${res.status})`);
  }
  if (json.status !== 'success' || !json.items) {
    throw new Error(json.message || '取得に失敗しました');
  }
  return json.items;
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

interface WineTastingNoteAssetLinkResponse {
  status: 'success' | 'error';
  assetId?: string;
  duplicate?: boolean;
  message?: string;
  code?: string;
}

// Stage 1D-A link API client。本文POST/PATCHとは非結合（Final Design比較A）。
// v1ではrole='label'固定
export async function linkWineTastingNotePhoto(noteId: string, assetId: string, idToken: string): Promise<{ duplicate: boolean }> {
  let res: Response;
  try {
    res = await fetch(wineTastingNoteAssetsUrl(noteId), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
      body: JSON.stringify({ assetId, role: 'label' }),
    });
  } catch {
    throw new Error('ネットワークエラーが発生しました。通信状況を確認してください。');
  }
  if (res.status === 401) {
    throw new TokenExpiredError('ログインセッションが切れました。再度ログインしてください。');
  }
  let json: WineTastingNoteAssetLinkResponse;
  try {
    json = await res.json();
  } catch {
    throw new Error(`サーバーエラー (HTTP ${res.status})`);
  }
  if (json.status !== 'success') {
    throw new Error(json.message || '写真の紐付けに失敗しました');
  }
  return { duplicate: json.duplicate ?? false };
}

interface WineTastingNoteUnlinkResponse {
  status: 'success' | 'error';
  removed?: boolean;
  message?: string;
}

// Stage 1D-A unlink API client。既存linkが無い場合もidempotent success
export async function unlinkWineTastingNotePhoto(noteId: string, idToken: string): Promise<{ removed: boolean }> {
  let res: Response;
  try {
    res = await fetch(wineTastingNoteLabelAssetUrl(noteId), {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${idToken}` },
    });
  } catch {
    throw new Error('ネットワークエラーが発生しました。通信状況を確認してください。');
  }
  if (res.status === 401) {
    throw new TokenExpiredError('ログインセッションが切れました。再度ログインしてください。');
  }
  let json: WineTastingNoteUnlinkResponse;
  try {
    json = await res.json();
  } catch {
    throw new Error(`サーバーエラー (HTTP ${res.status})`);
  }
  if (json.status !== 'success') {
    throw new Error(json.message || '写真の紐付け解除に失敗しました');
  }
  return { removed: json.removed ?? false };
}
