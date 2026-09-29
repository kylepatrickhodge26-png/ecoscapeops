import { z } from "zod";

import { addDays, formatShortDate } from "@/lib/dates";

// One day of the forecast for the service area, on the area's own calendar.
export type ForecastDay = {
  date: string; // YYYY-MM-DD
  rainChance: number; // 0–100
  summary: string;
  high: number | null; // °F
  low: number | null;
};

// The parts of a National Weather Service forecast we use: day and night periods, each
// with its local start time, temperature (°F), chance of rain (%) and a short summary.
// https://www.weather.gov/documentation/services-web-api (/gridpoints/{wfo}/{x},{y}/forecast)
const nwsForecastSchema = z.object({
  properties: z.object({
    periods: z.array(
      z.object({
        // e.g. "2026-09-29T06:00:00-04:00": the first 10 characters are the local date.
        startTime: z.string().regex(/^\d{4}-\d{2}-\d{2}T/),
        isDaytime: z.boolean(),
        temperature: z.number().nullish(),
        probabilityOfPrecipitation: z.object({ value: z.number().min(0).max(100).nullable() }).nullish(),
        shortForecast: z.string().nullish(),
      }),
    ),
  }),
});

// Folds the day and night periods into one entry per date. A date's chance of rain is
// the higher of its day and night chances (as in the prototype); its high comes from the
// daytime period and its low from the night that follows.
export function parseNwsForecast(json: unknown): ForecastDay[] | null {
  const parsed = nwsForecastSchema.safeParse(json);
  if (!parsed.success) return null;

  const byDate = new Map<string, ForecastDay>();
  for (const period of parsed.data.properties.periods) {
    const date = period.startTime.slice(0, 10);
    const day = byDate.get(date) ?? { date, rainChance: 0, summary: "", high: null, low: null };
    day.rainChance = Math.max(day.rainChance, Math.round(period.probabilityOfPrecipitation?.value ?? 0));
    const temperature = period.temperature ?? null;
    if (period.isDaytime) {
      day.high = temperature;
      day.summary = period.shortForecast ?? day.summary;
    } else {
      day.low = temperature;
      if (!day.summary) day.summary = period.shortForecast ?? "";
    }
    byDate.set(date, day);
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

// Today and the next two days, as far as the forecast covers them.
export const RISK_WINDOW_DAYS = 3;

export function riskWindow(days: ForecastDay[], today: string): ForecastDay[] {
  const window = Array.from({ length: RISK_WINDOW_DAYS }, (_, i) => addDays(today, i));
  return window.flatMap((date) => days.filter((d) => d.date === date).slice(0, 1));
}

// The day in the window with the highest chance of rain (the earliest one on a tie).
export function topRainRisk(days: ForecastDay[], today: string): ForecastDay | null {
  return riskWindow(days, today).reduce<ForecastDay | null>(
    (best, day) => (best === null || day.rainChance > best.rainChance ? day : best),
    null,
  );
}

// "today", "tomorrow", or "Thu, Oct 1".
export function dayLabel(date: string, today: string): string {
  if (date === today) return "today";
  if (date === addDays(today, 1)) return "tomorrow";
  return formatShortDate(date);
}

// A chance of rain high enough to think about moving visits.
export const RAIN_LIKELY = 50;
