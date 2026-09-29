import "server-only";

import { z } from "zod";

import { parseNwsForecast, type ForecastDay } from "./forecast";

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

// /points tells us which forecast covers a location. That rarely changes, so it's kept
// for a day.
const pointsSchema = z.object({ properties: z.object({ forecast: z.string() }) });

export type ForecastResult = { ok: true; days: ForecastDay[] } | { ok: false };

export async function getDailyForecast(latitude: number, longitude: number): Promise<ForecastResult> {
  const { baseUrl, cacheSeconds } = config();
  const cached = (seconds: number) =>
    cacheSeconds > 0 ? { next: { revalidate: seconds } } : { cache: "no-store" as const };
  const headers = { "User-Agent": USER_AGENT, Accept: "application/geo+json" };

  try {
    // Four decimal places is the most the API accepts (about 10 m).
    const points = await fetch(`${baseUrl}/points/${latitude.toFixed(4)},${longitude.toFixed(4)}`, {
      headers,
      ...cached(86_400),
      signal: AbortSignal.timeout(8_000),
    });
    if (!points.ok) {
      console.error(`NWS points lookup failed: HTTP ${points.status}`);
      return { ok: false };
    }
    const forecastUrl = pointsSchema.safeParse(await points.json()).data?.properties.forecast;
    // Only ever follow a link back to the weather service itself.
    if (!forecastUrl?.startsWith(`${baseUrl}/`)) {
      console.error("NWS points lookup had no usable forecast link");
      return { ok: false };
    }

    const forecast = await fetch(forecastUrl, { headers, ...cached(cacheSeconds), signal: AbortSignal.timeout(8_000) });
    if (!forecast.ok) {
      console.error(`NWS forecast failed: HTTP ${forecast.status}`);
      return { ok: false };
    }
    const days = parseNwsForecast(await forecast.json());
    if (!days) {
      console.error("NWS forecast had an unexpected shape");
      return { ok: false };
    }
    return { ok: true, days };
  } catch (error) {
    console.error("NWS forecast failed", error instanceof Error ? error.message : error);
    return { ok: false };
  }
}
