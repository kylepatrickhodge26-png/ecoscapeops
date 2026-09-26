// Calendar dates as "YYYY-MM-DD" strings. Arithmetic is done in UTC so days are
// always exactly 24 hours (no daylight-saving surprises); a visit's date is just a
// date, not a moment in time.

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_MONTH = /^\d{4}-\d{2}$/;

function toUTC(isoDate: string): Date {
  return new Date(`${isoDate}T00:00:00Z`);
}

function fromUTC(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function isISODate(value: unknown): value is string {
  if (typeof value !== "string" || !ISO_DATE.test(value)) return false;
  const date = toUTC(value);
  // Rejects impossible dates like Feb 30, which don't round-trip.
  return !Number.isNaN(date.getTime()) && fromUTC(date) === value;
}

export function isISOMonth(value: unknown): value is string {
  return typeof value === "string" && ISO_MONTH.test(value) && isISODate(`${value}-01`);
}

export function addDays(isoDate: string, days: number): string {
  const d = toUTC(isoDate);
  d.setUTCDate(d.getUTCDate() + days);
  return fromUTC(d);
}

// Today's date where the business is.
export function todayInTimeZone(timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone }).format(new Date());
}

// 0 = Sunday … 6 = Saturday
export function weekdayOf(isoDate: string): number {
  return toUTC(isoDate).getUTCDay();
}

export function nextWeekdayOnOrAfter(isoDate: string, weekday: number): string {
  return addDays(isoDate, (weekday - weekdayOf(isoDate) + 7) % 7);
}

const formatters = {
  short: new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" }),
  long: new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  }),
  month: new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "long", year: "numeric" }),
};

// "Tue, Sep 29"
export const formatShortDate = (isoDate: string) => formatters.short.format(toUTC(isoDate));
// "Tuesday, September 29, 2026"
export const formatLongDate = (isoDate: string) => formatters.long.format(toUTC(isoDate));
// "September 2026"
export const formatMonth = (isoMonth: string) => formatters.month.format(toUTC(`${isoMonth}-01`));

export const monthOf = (isoDate: string) => isoDate.slice(0, 7);

export function addMonths(isoMonth: string, months: number): string {
  const d = toUTC(`${isoMonth}-01`);
  d.setUTCMonth(d.getUTCMonth() + months);
  return fromUTC(d).slice(0, 7);
}

// The weeks (Sunday first) shown for a month on a calendar, including the days from
// the neighbouring months that fill out the first and last weeks.
export function monthGrid(isoMonth: string): string[][] {
  const first = `${isoMonth}-01`;
  const last = addDays(`${addMonths(isoMonth, 1)}-01`, -1);
  let day = addDays(first, -weekdayOf(first));
  const end = addDays(last, 6 - weekdayOf(last));

  const weeks: string[][] = [];
  while (day <= end) {
    const week: string[] = [];
    for (let i = 0; i < 7; i++) {
      week.push(day);
      day = addDays(day, 1);
    }
    weeks.push(week);
  }
  return weeks;
}
