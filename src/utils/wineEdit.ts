import type { WineEntity } from '../types/wineEntity';
import type { WinePatchChanges, WineHistoryItem } from '../api/wineEntityApi';
import type { EditEquals } from './editCore';
import { diffByKeys } from './editCore';
import type { EditHistoryViewItem } from '../components/edit/EditHistoryList';

// Wine 本体の編集画面の純粋ロジック（Wine Editing、2026-09-28）。共通 UX（editCore）の上に Wine 固有の項目を載せる。
// 写真は 1 枚目（ボトル写真）だけをフォームで直し、2 枚目以降（元データの画像）はそのまま残す
// （旧フォームは保存のたびに photos を 1 枚目だけに置き換えていた）

export interface WineEditValues {
  photoUrl: string;
  title: string;
  producer: string;
  vintage: string; // フォームの入力値（空欄可）
  variety: string;
  origin: string;
  description: string;
}

export const WINE_EDIT_KEYS = ['photoUrl', 'title', 'producer', 'vintage', 'variety', 'origin', 'description'] as const;

export const WINE_FORM_LABELS: Record<keyof WineEditValues, string> = {
  photoUrl: '写真', title: 'ワイン名', producer: '生産者', vintage: 'ヴィンテージ',
  variety: '品種', origin: '産地', description: 'メモ',
};

// 履歴（API の項目名）の表示名
export const WINE_HISTORY_LABELS: Record<string, string> = {
  title: 'ワイン名', producer: '生産者', vintage: 'ヴィンテージ', variety: '品種', origin: '産地',
  description: 'メモ', photos: '写真', tags: 'タグ', status: '状態',
};

export function valuesFromWine(w: WineEntity): WineEditValues {
  return {
    photoUrl: w.photos[0] ?? '',
    title: w.title,
    producer: w.producer,
    vintage: w.vintage != null ? String(w.vintage) : '',
    variety: w.variety,
    origin: w.origin,
    description: w.description,
  };
}

// サーバーは前後の空白を落として保存するので、画面の比較も同じにする（空白だけの違いを変更にしない）
export const wineEquals: EditEquals<WineEditValues> = (_k, a, b) => String(a).trim() === String(b).trim();

export function changedWineKeys(base: WineEditValues, form: WineEditValues): (keyof WineEditValues)[] {
  return Object.keys(diffByKeys(WINE_EDIT_KEYS, base, form, wineEquals)) as (keyof WineEditValues)[];
}

// 変えた項目だけを API の形へ。写真は 1 枚目だけ差し替え、元データの画像（2 枚目以降）は残す
export function wineChangesFromForm(base: WineEditValues, form: WineEditValues, currentPhotos: string[]): WinePatchChanges {
  const changes: WinePatchChanges = {};
  for (const k of changedWineKeys(base, form)) {
    if (k === 'photoUrl') {
      const first = form.photoUrl.trim();
      changes.photos = first ? [first, ...currentPhotos.slice(1)] : currentPhotos.slice(1);
    } else if (k === 'vintage') {
      changes.vintage = form.vintage.trim() ? Number(form.vintage.trim()) : null;
    } else {
      changes[k] = form[k].trim();
    }
  }
  return changes;
}

export function validateWineForm(v: WineEditValues): string {
  if (!v.title.trim()) return 'ワイン名は必須です';
  const vin = v.vintage.trim();
  if (vin && (!/^\d+$/.test(vin) || Number(vin) < 1800 || Number(vin) > 2100)) return 'ヴィンテージは1800〜2100の西暦で入力してください（不明なら空欄）';
  return '';
}

function formatHistoryValue(field: string, v: string | null): string | null {
  if (v === null) return null;
  if (field === 'status') return v === 'archived' ? '無効化' : v === 'active' ? '有効' : v;
  if (field === 'photos' || field === 'tags') {
    try {
      const arr: unknown = JSON.parse(v);
      if (Array.isArray(arr)) return arr.length === 0 ? '' : arr.join('\n');
    } catch {
      return v;
    }
  }
  return v;
}

function historySourceLabel(item: WineHistoryItem): string {
  const statusChange = item.changes.find((c) => c.field === 'status');
  if (statusChange) return statusChange.new === 'archived' ? '無効化' : '有効に戻す';
  return item.source === 'detail' ? '編集' : item.source;
}

// 新しい順に並べ、共通の EditHistoryList の形へ
export function wineHistoryView(items: WineHistoryItem[]): EditHistoryViewItem[] {
  return [...items].reverse().map((it) => ({
    id: it.id,
    editedAt: it.editedAt,
    actorName: it.editedByName || it.editedBy,
    sourceLabel: historySourceLabel(it),
    reason: it.reason,
    changes: it.changes.map((c) => ({
      label: WINE_HISTORY_LABELS[c.field] ?? c.field,
      old: formatHistoryValue(c.field, c.old),
      new: formatHistoryValue(c.field, c.new),
    })),
  }));
}
