import { workEntryCorrectionsUrl } from '../config';
import { EDIT_ERROR_MESSAGES, throwIfEditError } from './editErrors';

// Work Log の訂正履歴（GET /work/:workId/entries/:sheetRow/corrections、読み取りのみ）。
// 正本は Sheets「作業ログ_訂正履歴」タブ。古い順で返る。訂正者は表示名（メールは返らない）

export interface WorkCorrectionItem {
  correctedAt: string;
  correctedByName: string;
  oldContent: string;
  oldCaption: string;
  newContent: string;
  newCaption: string;
  note: string;
}

export async function fetchWorkEntryCorrections(workId: string, sheetRow: number, idToken: string): Promise<WorkCorrectionItem[]> {
  let res: Response;
  try {
    res = await fetch(workEntryCorrectionsUrl(workId, sheetRow), { headers: { Authorization: `Bearer ${idToken}` } });
  } catch {
    throw new Error(EDIT_ERROR_MESSAGES.network);
  }
  let json: Record<string, unknown> = {};
  try {
    json = await res.json();
  } catch {
    throw new Error(`サーバーエラー (HTTP ${res.status})`);
  }
  throwIfEditError(res.status, json);
  return Array.isArray(json.items) ? (json.items as WorkCorrectionItem[]) : [];
}
