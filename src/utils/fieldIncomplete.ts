import type { FieldLogEntry } from '../types/zukan';

// Phase2 Unit F｜未整理フィールドログの分類。
//
// 既知の制約：
// foodName未入力を「一括写真の整理」対象（PC一括アップロード由来）としているが、
// 送信元を示す確定的なsource列はSheetに存在しない（Unit F-1調査で確認済み）。
// 現時点の実データ（recordedAt集中・kigo=未分類・elevation=null・notionUrl空、の4条件が
// 一致することが多い）に基づく代理判定であり、通常のフィールドログ登録で食材名未入力が
// 発生した場合も、このグループへ入る可能性がある。今回はSheetのスキーマ変更は行わない。

// グループA｜一括写真の整理対象：食材名が未入力
export function isBulkPhotoIncomplete(entry: FieldLogEntry): boolean {
  return entry.foodName.trim() === '';
}

// グループB｜記録の補完対象：食材名は入力済みだが、場所またはメモが未入力
export function isRecordIncomplete(entry: FieldLogEntry): boolean {
  if (isBulkPhotoIncomplete(entry)) return false;
  return entry.place.trim() === '' || entry.memo.trim() === '';
}

export type MissingField = 'place' | 'memo';

export function missingFieldsOf(entry: FieldLogEntry): MissingField[] {
  const missing: MissingField[] = [];
  if (entry.place.trim() === '') missing.push('place');
  if (entry.memo.trim() === '') missing.push('memo');
  return missing;
}

export interface FieldIncompleteCounts {
  bulkPhoto: number;
  recordCompletion: number;
}

export function countFieldIncomplete(entries: FieldLogEntry[]): FieldIncompleteCounts {
  let bulkPhoto = 0;
  let recordCompletion = 0;
  for (const e of entries) {
    if (isBulkPhotoIncomplete(e)) bulkPhoto++;
    else if (isRecordIncomplete(e)) recordCompletion++;
  }
  return { bulkPhoto, recordCompletion };
}
