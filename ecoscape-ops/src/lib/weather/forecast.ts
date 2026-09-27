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

// The parts of an OpenWeather One Call 3.0 response we use.
// https://openweathermap.org/api/one-call-3#current
const oneCallSchema = z.object({
  timezone_offset: z.number(),
  daily: z.array(
    z.object({
      // 12:00 local time, as a Unix timestamp.
      dt: z.number(),
      // Probability of precipitation, 0–1.
      pop: z.number().min(0).max(1).optional(),
      summary: z.string().optional(),
      temp: z.object({ min: z.number().optional(), max: z.number().optional() }).optional(),
      weather: z.array(z.object({ description: z.string().optional() })).optional(),
    }),
  ),
});

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function parseOneCall(json: unknown): ForecastDay[] | null {
  const parsed = oneCallSchema.safeParse(json);
  if (!parsed.success) return null;
  const { timezone_offset: offset, daily } = parsed.data;
  return daily.map((d) => ({
    // Shifting by the area's UTC offset turns local noon into a UTC time on the same
    // calendar day.
    date: new Date((d.dt + offset) * 1000).toISOString().slice(0, 10),
    rainChance: Math.round((d.pop ?? 0) * 100),
    summary: d.summary ?? capitalize(d.weather?.[0]?.description ?? ""),
    high: d.temp?.max != null ? Math.round(d.temp.max) : null,
    low: d.temp?.min != null ? Math.round(d.temp.min) : null,
  }));
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
