import {
  BULK_EDITABLE_FIELDS,
  type FieldBulkEditableField,
  type FieldBulkEditResultItem,
  type FieldEditOption,
  type FieldEditPatch,
  type FieldEditValues,
  type FieldEditableField,
  type FieldEntryDetail,
  type FieldEntryHistoryItem,
  type FieldOptionField,
} from '../types/fieldEntryEdit';
import { validateFoodName } from './foodNameValidation';

// Field Log 編集画面の純粋ロジック（差分・競合後の取り込み・選択肢・検証・履歴表示）。
// 検証の正本はWorker（PATCHで必ず再検証される）。ここでの検証は入力中の案内のためのもの。

export const FIELD_EDIT_ORDER: FieldEditableField[] = [
  'food', 'date', 'place', 'memo', 'subject_type', 'large_category', 'sub_category', 'phase',
  'observed_parts', 'identification_status', 'harvested',
];

export const FIELD_LABELS: Record<string, string> = {
  food: '食材名',
  date: '観察日',
  place: '場所',
  memo: 'メモ',
  subject_type: '記録の種類',
  large_category: '大分類',
  sub_category: '小分類',
  phase: 'フェーズ',
  observed_parts: '観察部位',
  identification_status: '同定状態',
  harvested: '採取',
  kigo: '余市節気',
  yoichi_season_id: '余市節気（ID）',
};

// 編集項目 → 選択肢マスタのfield
export const OPTION_FIELD_OF: Partial<Record<FieldEditableField, FieldOptionField>> = {
  subject_type: 'record_type',
  large_category: 'large_category',
  sub_category: 'sub_category',
  phase: 'phase',
  identification_status: 'identification_status',
  harvested: 'harvested',
  observed_parts: 'observed_part',
};

export function valuesFromDetail(d: FieldEntryDetail): FieldEditValues {
  return {
    food: d.food,
    date: d.date,
    place: d.place,
    memo: d.memo,
    large_category: d.large_category,
    sub_category: d.sub_category,
    phase: d.phase,
    harvested: d.harvested,
    identification_status: d.identification_status,
    observed_parts: [...d.observed_parts],
    subject_type: d.subject_type,
  };
}

function sameValue(field: FieldEditableField, a: FieldEditValues, b: FieldEditValues): boolean {
  if (field === 'observed_parts') return a.observed_parts.join(',') === b.observed_parts.join(',');
  // 食材名・日付はWorkerがtrimしてから比べるので、画面側も同じ扱いにする
  if (field === 'food' || field === 'date') return a[field].trim() === b[field].trim();
  return a[field] === b[field];
}

// 元の値から変えた項目だけを送る（変えていない項目を送ると、他の人の変更を上書きしうるため）
export function diffValues(base: FieldEditValues, form: FieldEditValues): FieldEditPatch {
  const patch: FieldEditPatch = {};
  for (const f of FIELD_EDIT_ORDER) {
    if (sameValue(f, base, form)) continue;
    if (f === 'observed_parts') patch.observed_parts = [...form.observed_parts];
    else patch[f] = form[f];
  }
  return patch;
}

export interface RebaseResult {
  values: FieldEditValues;
  // 自分が変えていた項目（最新の内容の上に、そのまま残した）
  mine: FieldEditableField[];
  // 自分も他の人も変えていた項目（自分の値を残しているので、保存すると他の人の変更を置き換える）
  overlap: FieldEditableField[];
}

// 409（他の人が先に保存した）の後、最新の内容を読み込み直す。自分が変えていない項目は最新の値に、
// 自分が変えた項目は自分の値のままにする。自動では保存しない（人が確認してから保存する）
export function rebaseAfterConflict(oldBase: FieldEditValues, form: FieldEditValues, latest: FieldEditValues): RebaseResult {
  const values: FieldEditValues = { ...latest, observed_parts: [...latest.observed_parts] };
  const mine: FieldEditableField[] = [];
  const overlap: FieldEditableField[] = [];
  for (const f of FIELD_EDIT_ORDER) {
    if (sameValue(f, oldBase, form)) continue;
    mine.push(f);
    if (f === 'observed_parts') values.observed_parts = [...form.observed_parts];
    else values[f] = form[f];
    if (!sameValue(f, oldBase, latest) && !sameValue(f, latest, form)) overlap.push(f);
  }
  return { values, mine, overlap };
}

export interface SelectChoice {
  value: string;
  label: string;
  inactive: boolean; // 無効化された値（今の記録に残っている時だけ表示する）
}

function sortOptions(a: FieldEditOption, b: FieldEditOption): number {
  return a.sortOrder - b.sortOrder || a.value.localeCompare(b.value);
}

// 選べる選択肢。有効なもの＋（小分類・フェーズは）大分類に合うもの。今の値が選択肢に無ければ、消さずに先頭へ残す
export function choicesFor(
  field: FieldEditableField,
  options: FieldEditOption[],
  largeCategory: string,
  currentValue: string,
): SelectChoice[] {
  const optionField = OPTION_FIELD_OF[field];
  if (!optionField) return [];
  const matchesParent = (o: FieldEditOption) =>
    (field !== 'sub_category' && field !== 'phase') || o.parentValue === null || o.parentValue === largeCategory;
  const active = options
    .filter((o) => o.field === optionField && o.isActive && matchesParent(o))
    .sort(sortOptions)
    .map((o) => ({ value: o.value, label: o.label, inactive: false }));
  if (currentValue && !active.some((c) => c.value === currentValue)) {
    const known = options.find((o) => o.field === optionField && o.value === currentValue);
    active.unshift({ value: currentValue, label: known?.label ?? currentValue, inactive: true });
  }
  return active;
}

// 大分類を変えた時、新しい大分類で選べない小分類・フェーズを合わせる。
// 小分類は空欄にできない（Workerが選択肢に無い値として拒否する）ので「不明」、フェーズは空欄（未記録）に戻す
export function adjustForLargeCategory(values: FieldEditValues, options: FieldEditOption[]): FieldEditValues {
  const next = { ...values };
  const fits = (optionField: FieldOptionField, value: string) => {
    const o = options.find((x) => x.field === optionField && x.value === value);
    return !o || o.parentValue === null || o.parentValue === next.large_category;
  };
  if (next.sub_category && !fits('sub_category', next.sub_category)) {
    next.sub_category = options.some((o) => o.field === 'sub_category' && o.value === '不明' && o.isActive) ? '不明' : next.sub_category;
  }
  if (next.phase && !fits('phase', next.phase)) next.phase = '';
  return next;
}

// 観察部位のチェックを切り替える。元の並びを保ち、新しく付けたものは末尾へ（並べ替えだけの変更を作らない）
export function toggleObservedPart(parts: string[], value: string): string[] {
  return parts.includes(value) ? parts.filter((p) => p !== value) : [...parts, value];
}

export function validateEditValues(v: FieldEditValues): Partial<Record<FieldEditableField, string>> {
  const errors: Partial<Record<FieldEditableField, string>> = {};
  const foodError = validateFoodName(v.food);
  if (foodError) errors.food = foodError;
  else if (v.food.trim().length > 200) errors.food = '食材名は200文字以内で入力してください';
  const date = v.date.trim();
  const d = new Date(`${date}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== date) {
    errors.date = '観察日を選んでください';
  }
  if (v.place.length > 500) errors.place = '場所は500文字以内で入力してください';
  if (v.memo.length > 5000) errors.memo = 'メモは5000文字以内で入力してください';
  return errors;
}

export function historySourceLabel(item: FieldEntryHistoryItem): string {
  switch (item.source) {
    case 'detail': return '詳細画面で編集';
    case 'bulk': return 'まとめて編集';
    case 'legacy_gas': return '旧システムで編集';
    case 'system': return item.derived ? '自動再計算（観察日の変更による）' : '自動整理（データ正規化）';
    default: return item.source;
  }
}

export function formatHistoryTime(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso;
  return new Date(t).toLocaleString('ja-JP', {
    timeZone: 'Asia/Tokyo', year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

export function formatHistoryValue(v: string | null): string {
  return v === null || v === '' ? '（空欄）' : v;
}

// 画面には新しい順で出す（APIは古い順で返す）。内部用の余市節気IDは名前（kigo）と重複するので出さない
export function historyForDisplay(items: FieldEntryHistoryItem[]): FieldEntryHistoryItem[] {
  return [...items]
    .reverse()
    .map((it) => ({ ...it, changes: it.changes.filter((c) => c.field !== 'yoichi_season_id') }))
    .filter((it) => it.changes.length > 0);
}

export interface BulkEditSummary {
  succeeded: string[]; // 成立（applied）＋すでに成立済み（alreadyApplied）＋変更なし（noChange）
  applied: string[]; // 今回実際に値が変わった記録（画面の最新値へ反映する対象）
  noChange: string[];
  conflicted: FieldBulkEditResultItem[]; // 他の人が先に更新していた（409相当）。何も書かれていない
  failed: FieldBulkEditResultItem[]; // 見つからない・選択肢の検証エラーなど
}

// まとめて編集の結果を「成功／競合／失敗」に分ける。部分成功は正常な結果として扱う
export function summarizeBulkResults(results: FieldBulkEditResultItem[]): BulkEditSummary {
  const s: BulkEditSummary = { succeeded: [], applied: [], noChange: [], conflicted: [], failed: [] };
  for (const r of results) {
    if (r.ok) {
      s.succeeded.push(r.eventId);
      if (r.outcome === 'noChange') s.noChange.push(r.eventId);
      else s.applied.push(r.eventId);
    } else if (r.code === 'EDIT_CONFLICT') {
      s.conflicted.push(r);
    } else {
      s.failed.push(r);
    }
  }
  return s;
}

// まとめて編集のフォーム。nullの項目は「変更しない」（送らない）
export type BulkEditForm = { [K in FieldBulkEditableField]: FieldEditValues[K] | null };

export const EMPTY_BULK_FORM: BulkEditForm = {
  place: null, subject_type: null, large_category: null, sub_category: null, phase: null,
  observed_parts: null, identification_status: null, harvested: null,
};

export function bulkPatchFromForm(form: BulkEditForm): FieldEditPatch {
  const patch: FieldEditPatch = {};
  for (const f of BULK_EDITABLE_FIELDS) {
    const v = form[f];
    if (v === null) continue;
    if (f === 'observed_parts') patch.observed_parts = [...(v as string[])];
    else (patch as Record<string, unknown>)[f] = v;
  }
  return patch;
}

// takenAt（撮影日時・秒単位のISO文字列）から時刻部分（HH:MM）だけを取り出す。
// 同じ日・同じ場所で何枚も撮った記録を人が見分けるのに使う（一括写真の整理・まとめて編集の結果）
export function formatTakenTime(takenAt: string): string {
  if (!takenAt) return '';
  const d = new Date(takenAt);
  if (isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
