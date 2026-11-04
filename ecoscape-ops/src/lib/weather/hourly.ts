import { z } from "zod";

import { addDays, weekdayOf } from "@/lib/dates";

import { RAIN_LIKELY } from "./forecast";

// The National Weather Service's hour-by-hour forecast, read for the hours the crew works:
// "rain likely 10am–2pm". It covers about the next 6½ days.
// https://www.weather.gov/documentation/services-web-api (/gridpoints/{wfo}/{x},{y}/forecast/hourly)

export type ForecastHour = {
  start: number; // ms since 1970
  end: number;
  rainChance: number; // 0–100
  summary: string;
};

const nwsHourlySchema = z.object({
  properties: z.object({
    periods: z.array(
      z.object({
        // e.g. "2026-11-09T10:00:00-05:00"
        startTime: z.string(),
        endTime: z.string(),
        probabilityOfPrecipitation: z.object({ value: z.number().min(0).max(100).nullable() }).nullish(),
        shortForecast: z.string().nullish(),
      }),
    ),
  }),
});

export function parseNwsHourly(json: unknown): ForecastHour[] | null {
  const parsed = nwsHourlySchema.safeParse(json);
  if (!parsed.success) return null;
  const hours: ForecastHour[] = [];
  for (const period of parsed.data.properties.periods) {
    const start = Date.parse(period.startTime);
    const end = Date.parse(period.endTime);
    if (Number.isNaN(start) || Number.isNaN(end) || end <= start) continue;
    hours.push({
      start,
      end,
      rainChance: Math.round(period.probabilityOfPrecipitation?.value ?? 0),
      summary: period.shortForecast ?? "",
    });
  }
  return hours.sort((a, b) => a.start - b.start);
}

// ---------------------------------------------------------------------------
// Work hours
// ---------------------------------------------------------------------------

// When the crew works, in minutes after midnight where the business is (8:00 AM is 480).
export type WorkHours = { start: number; end: number };

export const DEFAULT_WORK_HOURS: WorkHours = { start: 8 * 60, end: 16 * 60 };

// Earliest start and latest end the settings allow, and the step between choices.
export const EARLIEST_START = 4 * 60;
export const LATEST_END = 22 * 60;
export const WORK_TIME_CHOICES = Array.from({ length: (LATEST_END - EARLIEST_START) / 30 + 1 }, (_, i) => EARLIEST_START + i * 30);

// "08:00:00" (a time as the database sends it) or "08:00" → 480.
export function minutesOf(time: unknown): number | null {
  if (typeof time !== "string") return null;
  const m = /^(\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?$/.exec(time);
  if (!m) return null;
  const hours = Number(m[1]);
  const minutes = Number(m[2]);
  return hours > 23 || minutes > 59 ? null : hours * 60 + minutes;
}

// 480 → "08:00", as the database and the form take it.
export const timeValue = (minutes: number) =>
  `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;

const halfOf = (minutes: number) => (Math.floor(minutes / 60) % 24 < 12 ? "am" : "pm");

// 480 → "8am", 630 → "10:30am", 720 → "12pm".
export function clockLabel(minutes: number, suffix = true): string {
  const hour = Math.floor(minutes / 60) % 24;
  const min = minutes % 60;
  return `${hour % 12 === 0 ? 12 : hour % 12}${min ? `:${String(min).padStart(2, "0")}` : ""}${suffix ? halfOf(minutes) : ""}`;
}

// "10am–2pm", or "10–11am" when both are in the morning (or both in the afternoon).
export function spanLabel(start: number, end: number): string {
  return halfOf(start) === halfOf(end) ? `${clockLabel(start, false)}–${clockLabel(end)}` : `${clockLabel(start)}–${clockLabel(end)}`;
}

// For a work-hours dropdown: "8:00 AM".
export function choiceLabel(minutes: number): string {
  const hour = Math.floor(minutes / 60) % 24;
  return `${hour % 12 === 0 ? 12 : hour % 12}:${String(minutes % 60).padStart(2, "0")} ${hour < 12 ? "AM" : "PM"}`;
}

// ---------------------------------------------------------------------------
// The business's calendar and clock
// ---------------------------------------------------------------------------

const partsFormatters = new Map<string, Intl.DateTimeFormat>();

// Where a moment falls on the business's calendar and clock: its date and minutes after midnight.
export function localTime(ms: number, timeZone: string): { date: string; minutes: number } {
  let formatter = partsFormatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
    partsFormatters.set(timeZone, formatter);
  }
  const parts = Object.fromEntries(formatter.formatToParts(new Date(ms)).map((p) => [p.type, p.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, minutes: (Number(parts.hour) % 24) * 60 + Number(parts.minute) };
}

// Sunday is a day off: nothing is moved to or from a Sunday automatically.
export const isWorkDay = (date: string) => weekdayOf(date) !== 0;

// ---------------------------------------------------------------------------
// Rain during work hours
// ---------------------------------------------------------------------------

export type RainWindow = { start: number; end: number }; // minutes after midnight

export type DayRain = {
  date: string;
  // When rain is likely (RAIN_LIKELY or more) during work hours, earliest first.
  windows: RainWindow[];
  // The highest chance of rain during that day's work hours.
  chance: number;
  // Whether the forecast reaches every one of that day's work hours (today's earlier hours
  // and the end of the forecast are missing).
  covered: boolean;
  // Every wet hour says snow, not rain.
  snow: boolean;
};

const WET = /rain|shower|drizzle|thunder|storm|sleet/i;

// Each day's rain during work hours, earliest day first. Days without any forecast hour in
// work hours aren't listed.
export function workdayRain(hours: ForecastHour[], work: WorkHours, timeZone: string, likely = RAIN_LIKELY): DayRain[] {
  type Tally = { date: string; minutes: number; chance: number; wet: RainWindow[]; summaries: string[] };
  const byDate = new Map<string, Tally>();
  for (const hour of hours) {
    const { date, minutes } = localTime(hour.start, timeZone);
    const from = Math.max(minutes, work.start);
    const to = Math.min(minutes + Math.round((hour.end - hour.start) / 60_000), work.end);
    if (to <= from) continue;
    const tally = byDate.get(date) ?? { date, minutes: 0, chance: 0, wet: [], summaries: [] };
    tally.minutes += to - from;
    tally.chance = Math.max(tally.chance, hour.rainChance);
    if (hour.rainChance >= likely) {
      tally.wet.push({ start: from, end: to });
      tally.summaries.push(hour.summary);
    }
    byDate.set(date, tally);
  }

  return [...byDate.values()]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((t) => ({
      date: t.date,
      windows: merge(t.wet),
      chance: t.chance,
      covered: t.minutes >= work.end - work.start,
      snow: t.summaries.length > 0 && t.summaries.every((s) => /snow|flurr/i.test(s) && !WET.test(s)),
    }));
}

function merge(windows: RainWindow[]): RainWindow[] {
  const sorted = [...windows].sort((a, b) => a.start - b.start);
  const merged: RainWindow[] = [];
  for (const w of sorted) {
    const last = merged.at(-1);
    if (last && w.start <= last.end) last.end = Math.max(last.end, w.end);
    else merged.push({ ...w });
  }
  return merged;
}

export const rainOn = (days: DayRain[], date: string): DayRain | undefined => days.find((d) => d.date === date);

// A day with rain likely during work hours.
export type WetDay = DayRain & { windows: [RainWindow, ...RainWindow[]] };

export const isRainy = (day: DayRain | undefined): day is WetDay => Boolean(day && day.windows.length > 0);

// "10am–2pm", "all day", or "8–9am, 2–4pm". Empty for a dry day.
export function rainHoursLabel(day: DayRain, work: WorkHours): string {
  const w = day.windows;
  if (w.length === 0) return "";
  if (w.length === 1 && w[0].start <= work.start && w[0].end >= work.end) return "all day";
  if (w.length <= 2) return w.map((x) => spanLabel(x.start, x.end)).join(", ");
  return spanLabel(w[0].start, w.at(-1)!.end);
}

// The same, short enough for a phone's calendar square: "10–2", "all day", or "8–9+" when
// there's more than one shower.
export function shortRainHoursLabel(day: DayRain, work: WorkHours): string {
  const w = day.windows;
  if (w.length === 0) return "";
  if (w.length === 1 && w[0].start <= work.start && w[0].end >= work.end) return "all day";
  return `${clockLabel(w[0].start, false)}–${clockLabel(w[0].end, false)}${w.length > 1 ? "+" : ""}`;
}

// "Rain" or "Snow".
export const wetWord = (day: DayRain) => (day.snow ? "Snow" : "Rain");

// ---------------------------------------------------------------------------
// Moving visits for rain automatically
// ---------------------------------------------------------------------------

// The day the automatic rain check is about right now, or null. In the morning before work
// starts it's today; after work it's tomorrow (the night before). During the work day, and
// on a day off until the evening, there's nothing to decide.
export function rainCheckDay(now: number, timeZone: string, work: WorkHours): string | null {
  const { date, minutes } = localTime(now, timeZone);
  if (minutes < work.start) return isWorkDay(date) ? date : null;
  if (minutes >= work.end) {
    const next = addDays(date, 1);
    return isWorkDay(next) ? next : null;
  }
  return null;
}

// Where a rainy day's visits go: the next work day without rain likely during work hours, as
// far as the forecast shows (a day past the end of the forecast counts as dry). If every work
// day in the next `maxDays` looks wet, the next work day.
export function nextDryDay(date: string, days: DayRain[], maxDays = 6): string {
  let firstWorkDay: string | null = null;
  for (let i = 1; i <= maxDays; i++) {
    const day = addDays(date, i);
    if (!isWorkDay(day)) continue;
    firstWorkDay ??= day;
    if (!isRainy(rainOn(days, day))) return day;
  }
  return firstWorkDay ?? addDays(date, 1);
}
