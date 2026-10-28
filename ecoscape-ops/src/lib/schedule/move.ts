import { addDays } from "@/lib/dates";

// Choices for "Move to another day": Today, Tomorrow, then the rest of the week, skipping
// the day the visit is already on.

const weekdayShort = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "short" });
const long = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "long" });
const toUTC = (isoDate: string) => new Date(`${isoDate}T00:00:00Z`);

export type DayChoice = { date: string; label: string };

export function dayChoices(today: string, exclude: string | null, count = 7): DayChoice[] {
  const choices: DayChoice[] = [];
  for (let i = 0; i < count; i++) {
    const date = addDays(today, i);
    if (date === exclude) continue;
    const label = i === 0 ? "Today" : i === 1 ? "Tomorrow" : `${weekdayShort.format(toUTC(date))} ${Number(date.slice(8))}`;
    choices.push({ date, label });
  }
  return choices;
}

// "Wednesday"
export const weekdayName = (isoDate: string) => long.format(toUTC(isoDate));

// The first choice to offer: tomorrow, or the day after the visit if it's later than that.
export function suggestedDay(today: string, current: string): string {
  const tomorrow = addDays(today, 1);
  const after = addDays(current, 1);
  return after > tomorrow ? after : tomorrow === current ? addDays(tomorrow, 1) : tomorrow;
}

// The ids of the visits just moved, from the link after a move ("a,b,c"), keeping only real ids.
export function movedIds(param: unknown): string[] {
  if (typeof param !== "string") return [];
  return param
    .split(",")
    .filter((id) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id))
    .slice(0, 30);
}

// The text to send a customer whose visit moved. They can edit it before sending.
export function movedText(opts: { firstName: string; businessName: string; service: string; date: string }): string {
  const hello = opts.firstName.trim() ? `Hi ${opts.firstName.trim()}` : "Hi";
  const day = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "long", month: "long", day: "numeric" }).format(toUTC(opts.date));
  return `${hello}, it's ${opts.businessName}. We've moved your ${opts.service.toLowerCase()} to ${day}. Thanks!`;
}
