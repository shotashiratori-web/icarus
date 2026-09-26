// Field Log 編集（Editing & Classification）。キーはWorker/D1の列名に合わせる（変換表を作らない）

export type FieldEditableField =
  | 'food' | 'date' | 'place' | 'memo'
  | 'large_category' | 'sub_category' | 'phase' | 'harvested' | 'identification_status'
  | 'observed_parts' | 'subject_type';

export interface FieldEditValues {
  food: string;
  date: string;
  place: string;
  memo: string;
  large_category: string;
  sub_category: string;
  phase: string;
  harvested: string;
  identification_status: string;
  observed_parts: string[];
  subject_type: string;
}

export interface FieldEntryDetail extends FieldEditValues {
  eventId: string;
  kigo: string;
  createdBy: string;
  updatedAt: string; // 楽観ロック（expectedUpdatedAt）に使う
}

export type FieldEditPatch = Partial<FieldEditValues>;

// field_option_values.field
export type FieldOptionField =
  | 'large_category' | 'sub_category' | 'phase' | 'harvested' | 'identification_status' | 'observed_part' | 'record_type';

export interface FieldEditOption {
  field: FieldOptionField;
  value: string;
  label: string;
  parentValue: string | null;
  sortOrder: number;
  isActive: boolean;
}

export interface FieldEntryHistoryItem {
  id: string;
  editedAt: string;
  editedBy: string;
  editedByName: string;
  source: 'detail' | 'bulk' | 'system' | 'legacy_gas' | string;
  reason: string | null;
  bulkId: string | null;
  derived: boolean;
  changes: { field: string; old: string | null; new: string | null }[];
}

// まとめて編集で変えられる項目（Worker BULK_EDITABLE_FIELDSと同じ。食材名・観察日・メモは1件ずつ編集する）
export const BULK_EDITABLE_FIELDS = [
  'place', 'subject_type', 'large_category', 'sub_category', 'phase', 'observed_parts', 'identification_status', 'harvested',
] as const satisfies readonly FieldEditableField[];
export type FieldBulkEditableField = (typeof BULK_EDITABLE_FIELDS)[number];

export const BULK_EDIT_MAX_ENTRIES = 100;

export interface FieldBulkEditResultItem {
  eventId: string;
  ok: boolean;
  outcome?: 'applied' | 'noChange' | 'alreadyApplied';
  code?: string; // EDIT_CONFLICT / EDIT_NOT_FOUND / EDIT_VALIDATION
  message: string;
}

export interface FieldBulkEditResponse {
  bulkId: string;
  results: FieldBulkEditResultItem[];
}
