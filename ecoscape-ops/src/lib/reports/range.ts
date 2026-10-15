import { addDays, addMonths, isISODate, monthOf } from "@/lib/dates";

export type DateRange = { from: string; to: string };

export const MAX_RANGE_DAYS = 1830;

// The range a report covers. A month-to-date default; anything typed in the address bar is
// checked, so a bad or huge range falls back to the default instead of reaching the database.
export function parseRange(params: { from?: string | string[]; to?: string | string[] }, today: string): DateRange {
  const fallback = defaultRange(today);
  const { from, to } = params;
  if (!isISODate(from) || !isISODate(to)) return fallback;
  if (from > to) return fallback;
  if (daysBetween(from, to) > MAX_RANGE_DAYS) return fallback;
  return { from, to };
}

export function defaultRange(today: string): DateRange {
  return { from: `${monthOf(today)}-01`, to: today };
}

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

export type Preset = { key: string; label: string; range: DateRange };

export function presets(today: string): Preset[] {
  const month = monthOf(today);
  const lastMonth = addMonths(month, -1);
  const year = today.slice(0, 4);
  const lastYear = String(Number(year) - 1);
  return [
    { key: "month", label: "This month", range: { from: `${month}-01`, to: today } },
    { key: "last-month", label: "Last month", range: { from: `${lastMonth}-01`, to: addDays(`${month}-01`, -1) } },
    { key: "year", label: "This year", range: { from: `${year}-01-01`, to: today } },
    { key: "last-year", label: "Last year", range: { from: `${lastYear}-01-01`, to: `${lastYear}-12-31` } },
  ];
}
