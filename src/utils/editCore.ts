// 編集の共通ロジック（Editing & Classification 共通化 Audit §1・§5-2、2026-09-27）。
// Field で Production Gate を通った挙動（utils/fieldEntryEdit.ts）を、項目の型に依存しない形で再実装したもの。
// Field の既存コードはこのファイルを使わない（安定した Field を共通化のために書き換えない方針）。
// 最初の利用先は Work Log の訂正 UI、その後 Wine・Spot。

// 2 つの値が同じかどうか。既定は「文字列はそのまま比較、配列は並びも含めて比較」。
// 前後の空白を無視したい項目などはドメイン側で equals を渡す
export type EditEquals<T> = (key: keyof T, a: T[keyof T], b: T[keyof T]) => boolean;

export function defaultEditEquals<T>(_key: keyof T, a: T[keyof T], b: T[keyof T]): boolean {
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((v, i) => v === b[i]);
  return a === b;
}

// 元の値（base）から変えた項目だけを返す。変えていない項目を送ると、他の人の変更を上書きしうるため
export function diffByKeys<T extends object>(
  keys: readonly (keyof T)[],
  base: T,
  form: T,
  equals: EditEquals<T> = defaultEditEquals,
): Partial<T> {
  const patch: Partial<T> = {};
  for (const k of keys) {
    if (!equals(k, base[k], form[k])) patch[k] = form[k];
  }
  return patch;
}

export interface RebaseByKeysResult<T> {
  values: T;
  // 自分が変えていた項目（最新の内容の上に、自分の値のまま残した）
  mine: (keyof T)[];
  // 自分も他の人も変えていた項目（自分の値を残しているので、保存すると他の人の変更を置き換える）
  overlap: (keyof T)[];
}

// 409（他の人が先に保存した）の後、最新の内容を取り込む。自分が変えていない項目は最新の値に、
// 自分が変えた項目は自分の値のままにする。自動では保存しない（人が確認してから保存する）
export function rebaseByKeys<T extends object>(
  keys: readonly (keyof T)[],
  oldBase: T,
  form: T,
  latest: T,
  equals: EditEquals<T> = defaultEditEquals,
): RebaseByKeysResult<T> {
  const values = { ...latest };
  const mine: (keyof T)[] = [];
  const overlap: (keyof T)[] = [];
  for (const k of keys) {
    if (equals(k, oldBase[k], form[k])) continue;
    mine.push(k);
    values[k] = form[k];
    if (!equals(k, oldBase[k], latest[k]) && !equals(k, latest[k], form[k])) overlap.push(k);
  }
  return { values, mine, overlap };
}

// まとめて編集の結果を「成功／競合／失敗」に分ける（部分成功は正常な結果）。
// 各ドメインの結果を { id, outcome } に写してから渡す
export type BulkOutcome = 'applied' | 'noChange' | 'alreadyApplied' | 'conflict' | 'failed';

export interface BulkOutcomeItem {
  id: string;
  outcome: BulkOutcome;
  message?: string;
}

export interface BulkOutcomeSummary {
  succeeded: BulkOutcomeItem[]; // applied・alreadyApplied・noChange
  noChange: BulkOutcomeItem[];
  conflicted: BulkOutcomeItem[]; // 他の人が先に更新していた。何も書かれていない
  failed: BulkOutcomeItem[];
}

export function summarizeBulkOutcomes(items: BulkOutcomeItem[]): BulkOutcomeSummary {
  const s: BulkOutcomeSummary = { succeeded: [], noChange: [], conflicted: [], failed: [] };
  for (const it of items) {
    if (it.outcome === 'conflict') s.conflicted.push(it);
    else if (it.outcome === 'failed') s.failed.push(it);
    else {
      s.succeeded.push(it);
      if (it.outcome === 'noChange') s.noChange.push(it);
    }
  }
  return s;
}

// 履歴の時刻（日本時間）。+09:00 と Z が混在していても時刻として解釈する
export function formatEditTime(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso;
  return new Date(t).toLocaleString('ja-JP', {
    timeZone: 'Asia/Tokyo', year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

export function formatEditValue(v: string | null | undefined): string {
  return v === null || v === undefined || v === '' ? '（空欄）' : v;
}
