import "server-only";

import { z } from "zod";

import { parseOneCall, type ForecastDay } from "./forecast";

// OpenWeather: the Geocoding API turns a ZIP code into a map position, and One Call 3.0
// gives the daily forecast for it. The API key is a server-only environment variable.
// https://openweathermap.org/api/geocoding-api  https://openweathermap.org/api/one-call-3

type Config = { apiKey: string; baseUrl: string; cacheSeconds: number };

// Null until OPENWEATHER_API_KEY is set. OPENWEATHER_BASE_URL and
// OPENWEATHER_CACHE_SECONDS are only for tests.
function config(): Config | null {
  const apiKey = process.env.OPENWEATHER_API_KEY;
  if (!apiKey) return null;
  const cacheSeconds = process.env.OPENWEATHER_CACHE_SECONDS;
  return {
    apiKey,
    baseUrl: process.env.OPENWEATHER_BASE_URL || "https://api.openweathermap.org",
    // An hour: rain chances don't change minute to minute, and it keeps each area to at
    // most 24 forecast calls a day (OpenWeather's free allowance is 1,000 a day).
    cacheSeconds: cacheSeconds ? Number(cacheSeconds) : 3600,
  };
}

export const isWeatherConfigured = () => config() !== null;

export type Place = { postalCode: string; placeName: string; latitude: number; longitude: number };

const zipResponse = z.object({ zip: z.string(), name: z.string(), lat: z.number(), lon: z.number() });

export type GeocodeResult = { ok: true; place: Place } | { ok: false; reason: "not_configured" | "not_found" | "unavailable" };

export async function geocodeZip(zip: string): Promise<GeocodeResult> {
  const c = config();
  if (!c) return { ok: false, reason: "not_configured" };
  const url = `${c.baseUrl}/geo/1.0/zip?zip=${encodeURIComponent(zip)},US&appid=${encodeURIComponent(c.apiKey)}`;
  try {
    const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(8_000) });
    if (response.status === 404) return { ok: false, reason: "not_found" };
    if (!response.ok) {
      // Never log the URL: it contains the API key.
      console.error(`OpenWeather geocoding failed: HTTP ${response.status}`);
      return { ok: false, reason: "unavailable" };
    }
    const parsed = zipResponse.safeParse(await response.json());
    if (!parsed.success) return { ok: false, reason: "unavailable" };
    const { name, lat, lon } = parsed.data;
    return { ok: true, place: { postalCode: zip, placeName: name.slice(0, 100), latitude: lat, longitude: lon } };
  } catch (error) {
    console.error("OpenWeather geocoding failed", error instanceof Error ? error.message : error);
    return { ok: false, reason: "unavailable" };
  }
}

export type ForecastResult = { ok: true; days: ForecastDay[] } | { ok: false; reason: "not_configured" | "unavailable" };

export async function getDailyForecast(latitude: number, longitude: number): Promise<ForecastResult> {
  const c = config();
  if (!c) return { ok: false, reason: "not_configured" };
  // Rounded to about a kilometer, so nearby businesses share one cached forecast.
  const url =
    `${c.baseUrl}/data/3.0/onecall?lat=${latitude.toFixed(2)}&lon=${longitude.toFixed(2)}` +
    `&exclude=current,minutely,hourly,alerts&units=imperial&appid=${encodeURIComponent(c.apiKey)}`;
  try {
    const response = await fetch(url, {
      ...(c.cacheSeconds > 0 ? { next: { revalidate: c.cacheSeconds } } : { cache: "no-store" as const }),
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) {
      console.error(`OpenWeather forecast failed: HTTP ${response.status}`);
      return { ok: false, reason: "unavailable" };
    }
    const days = parseOneCall(await response.json());
    if (!days) {
      console.error("OpenWeather forecast had an unexpected shape");
      return { ok: false, reason: "unavailable" };
    }
    return { ok: true, days };
  } catch (error) {
    console.error("OpenWeather forecast failed", error instanceof Error ? error.message : error);
    return { ok: false, reason: "unavailable" };
  }
}
