import { isEnvironmentEntry, type FieldLogEntry } from '../types/zukan';
import type { EnvSpeciesItem } from './types';

// Field Log（環境）→ Environment Spot（帰宅後の整理。icarus_field_log_environment_capture_design.md §3）の純粋な部分

// Field Log の撮影日時（ISO・「2026:09:30 09:09:25」・「2026-09-30 09:09:25」など）→ ISO。時差が無ければ日本時間。読めなければ null
export function parseTakenAt(v: string | undefined | null): string | null {
  const m = (v ?? '').match(/^(\d{4})[-:/](\d{2})[-:/](\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?(.*)$/);
  if (!m) return null;
  const tz = /Z|[+-]\d{2}:?\d{2}$/.test(m[7] ?? '') ? m[7] : '+09:00';
  const d = new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6] ?? '00'}${tz}`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

// まだ Spot にしていない環境の記録（新しい順）。位置の無いものは Spot にできないので出さない
export function selectEnvCaptures(entries: FieldLogEntry[], promoted: Set<string>): FieldLogEntry[] {
  return entries
    .filter((e) => isEnvironmentEntry(e) && !e.environmentSpotId && !!e.eventId && !promoted.has(e.eventId) && Number.isFinite(e.lat) && Number.isFinite(e.lng))
    .sort((a, b) => (b.takenAt || b.date).localeCompare(a.takenAt || a.date));
}

// 近くの既存 Spot（m 以内、近い順）。近いから同じ木とは推定しない（人が「この木／別の木」を決める）
export function nearbySpots<T extends { lat: number; lng: number }>(e: { lat: number; lng: number }, spots: T[], withinM = 30): { spot: T; d: number }[] {
  const ky = 111320, kx = 111320 * Math.cos((e.lat * Math.PI) / 180);
  return spots
    .map((s) => ({ spot: s, d: Math.hypot((s.lat - e.lat) * ky, (s.lng - e.lng) * kx) }))
    .filter((x) => x.d <= withinM)
    .sort((a, b) => a.d - b.d);
}

// Field Log の名前 → 樹種マスタ（名前か別表記が一致するもの）。一致しなければ null（名前はメモへ）
export function speciesFromName(name: string, species: EnvSpeciesItem[]): string | null {
  const n = (name ?? '').normalize('NFKC').replace(/\s+/g, '');
  if (!n) return null;
  const t = species.find((sp) => sp.kind === 'tree' && !sp.isOther && !sp.isUnknown && (sp.name === n || sp.aliases.includes(n)));
  return t?.id ?? null;
}
