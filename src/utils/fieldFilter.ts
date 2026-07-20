import { computeDateRange, isDateInRange } from './fieldTimeFilter';
import type { FieldLogEntry } from '../types/zukan';

export function matchesFilter(
  entry: FieldLogEntry,
  dateRange: ReturnType<typeof computeDateRange>,
  kigoFilter: string,
  searchQuery: string,
): boolean {
  if (!isDateInRange(entry.date, dateRange)) return false;
  if (kigoFilter && entry.kigo !== kigoFilter) return false;
  const q = searchQuery.trim().toLowerCase();
  if (q) {
    const hay = `${entry.foodName}${entry.place}${entry.memo}${entry.kigo}${entry.date}`.toLowerCase();
    if (!hay.includes(q)) return false;
  }
  return true;
}
