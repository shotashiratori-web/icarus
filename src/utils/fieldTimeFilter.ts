export type TimeFilterKey =
  | 'all' | 'today' | '7days' | 'this-month' | 'this-year' | 'last-year-same' | 'custom'
  | `year-${string}`;

export interface DateRange {
  start: Date;
  end: Date;
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

// GAS版 dateRange() と同じ規則。nullは「絞り込みなし（すべて）」を意味する
export function computeDateRange(
  key: TimeFilterKey,
  now: Date,
  customRange?: { start: string; end: string } | null,
): DateRange | null {
  const today = startOfDay(now);

  if (key === 'today') return { start: today, end: today };
  if (key === '7days') return { start: addDays(today, -7), end: today };
  if (key === 'this-month') {
    return { start: new Date(today.getFullYear(), today.getMonth(), 1), end: new Date(today.getFullYear(), today.getMonth() + 1, 0) };
  }
  if (key === 'this-year') {
    return { start: new Date(today.getFullYear(), 0, 1), end: new Date(today.getFullYear(), 11, 31) };
  }
  if (key === 'last-year-same') {
    const base = new Date(today.getFullYear() - 1, today.getMonth(), today.getDate());
    return { start: addDays(base, -7), end: addDays(base, 7) };
  }
  if (key === 'custom' && customRange?.start && customRange?.end) {
    const start = parseLocalDate(customRange.start);
    const end = parseLocalDate(customRange.end);
    if (start && end) return { start, end };
    return null;
  }
  const yearMatch = key.match(/^year-(\d{4})$/);
  if (yearMatch) {
    const year = Number(yearMatch[1]);
    return { start: new Date(year, 0, 1), end: new Date(year, 11, 31) };
  }
  return null;
}

// 'YYYY-MM-DD'をローカルタイムゾーンの日付として解釈する。
// new Date(dateOnlyString)はUTC 0時として解釈される仕様のため、
// new Date(y, m, d)（ローカル）で組み立てたrangeの境界と比較するとズレが生じる。
// 例: JST環境でnew Date('2026-07-20')は2026-07-20T09:00 JSTになり、
//     「今日」の範囲（2026-07-20T00:00〜24:00 JST）からはみ出して不一致になる。
function parseLocalDate(dateStr: string): Date | null {
  const match = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;
  const [, y, m, d] = match;
  const date = new Date(Number(y), Number(m) - 1, Number(d));
  return isNaN(date.getTime()) ? null : date;
}

export function isDateInRange(dateStr: string, range: DateRange | null): boolean {
  if (!range) return true;
  if (!dateStr) return false;
  const d = parseLocalDate(dateStr);
  if (!d) return false;
  return d >= range.start && d <= range.end;
}

export function formatMonthDay(date: Date): string {
  return `${date.getMonth() + 1}月${date.getDate()}日`;
}

export function lastYearSameLabel(now: Date): string {
  const base = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate());
  return `去年の同じ時期 ${formatMonthDay(addDays(base, -7))}〜${formatMonthDay(addDays(base, 7))}`;
}
