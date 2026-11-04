import "server-only";

import { z } from "zod";

import { parseNwsForecast, type ForecastDay } from "./forecast";
import { parseNwsHourly, type ForecastHour } from "./hourly";

// The National Weather Service's free forecast API: no account or key. It asks every app
// to identify itself with a User-Agent, and to cache what it gets.
// https://www.weather.gov/documentation/services-web-api

const USER_AGENT = "EcoScape Ops (github.com/kylepatrickhodge26-png/ecoscapeops)";

// NWS_BASE_URL and WEATHER_CACHE_SECONDS are only for tests.
function config() {
  const cacheSeconds = process.env.WEATHER_CACHE_SECONDS;
  return {
    baseUrl: process.env.NWS_BASE_URL || "https://api.weather.gov",
    // An hour: rain chances don't change minute to minute.
    cacheSeconds: cacheSeconds ? Number(cacheSeconds) : 3600,
  };
}

// /points tells us which forecasts cover a location. That rarely changes, so it's kept
// for a day.
const pointsSchema = z.object({
  properties: z.object({ forecast: z.string().optional(), forecastHourly: z.string().optional() }),
});

type Link = "forecast" | "forecastHourly";

// Fetches one of a location's forecasts (the day-and-night one, or the hour-by-hour one) and
// parses it. Null if the location isn't covered, the service is down, or the answer is odd.
async function getForecast<T>(latitude: number, longitude: number, link: Link, parse: (json: unknown) => T | null): Promise<T | null> {
  const { baseUrl, cacheSeconds } = config();
  const cached = (seconds: number) =>
    cacheSeconds > 0 ? { next: { revalidate: seconds } } : { cache: "no-store" as const };
  const headers = { "User-Agent": USER_AGENT, Accept: "application/geo+json" };
  const what = link === "forecast" ? "forecast" : "hourly forecast";

  try {
    // Four decimal places is the most the API accepts (about 10 m).
    const points = await fetch(`${baseUrl}/points/${latitude.toFixed(4)},${longitude.toFixed(4)}`, {
      headers,
      ...cached(86_400),
      signal: AbortSignal.timeout(8_000),
    });
    if (!points.ok) {
      console.error(`NWS points lookup failed: HTTP ${points.status}`);
      return null;
    }
    const url = pointsSchema.safeParse(await points.json()).data?.properties[link];
    // Only ever follow a link back to the weather service itself.
    if (!url?.startsWith(`${baseUrl}/`)) {
      console.error(`NWS points lookup had no usable ${what} link`);
      return null;
    }

    const forecast = await fetch(url, { headers, ...cached(cacheSeconds), signal: AbortSignal.timeout(8_000) });
    if (!forecast.ok) {
      console.error(`NWS ${what} failed: HTTP ${forecast.status}`);
      return null;
    }
    const parsed = parse(await forecast.json());
    if (!parsed) console.error(`NWS ${what} had an unexpected shape`);
    return parsed;
  } catch (error) {
    console.error(`NWS ${what} failed`, error instanceof Error ? error.message : error);
    return null;
  }
}

export type ForecastResult = { ok: true; days: ForecastDay[] } | { ok: false };

export async function getDailyForecast(latitude: number, longitude: number): Promise<ForecastResult> {
  const days = await getForecast(latitude, longitude, "forecast", parseNwsForecast);
  return days ? { ok: true, days } : { ok: false };
}

export type HourlyResult = { ok: true; hours: ForecastHour[] } | { ok: false };

// The next 6½ days hour by hour, for "rain likely 10am–2pm".
export async function getHourlyForecast(latitude: number, longitude: number): Promise<HourlyResult> {
  const hours = await getForecast(latitude, longitude, "forecastHourly", parseNwsHourly);
  return hours ? { ok: true, hours } : { ok: false };
}
