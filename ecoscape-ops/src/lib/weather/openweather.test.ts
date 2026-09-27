import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { geocodeZip, getDailyForecast } from "./openweather";

function mockFetch(status: number, json: unknown) {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify(json), { status }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}
const calledUrl = (fetchMock: ReturnType<typeof mockFetch>) => new URL((fetchMock.mock.calls[0] as unknown as [string])[0]);
const calledInit = (fetchMock: ReturnType<typeof mockFetch>) => (fetchMock.mock.calls[0] as unknown as [string, RequestInit & { next?: unknown }])[1];

beforeEach(() => {
  vi.stubEnv("OPENWEATHER_API_KEY", "key&123");
  vi.stubEnv("OPENWEATHER_BASE_URL", "");
  vi.stubEnv("OPENWEATHER_CACHE_SECONDS", "");
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("geocodeZip", () => {
  it("looks up a US ZIP code", async () => {
    const fetchMock = mockFetch(200, { zip: "11779", name: "Lake Ronkonkoma", lat: 40.8154, lon: -73.1123, country: "US" });
    expect(await geocodeZip("11779")).toEqual({
      ok: true,
      place: { postalCode: "11779", placeName: "Lake Ronkonkoma", latitude: 40.8154, longitude: -73.1123 },
    });
    const url = calledUrl(fetchMock);
    expect(url.origin + url.pathname).toBe("https://api.openweathermap.org/geo/1.0/zip");
    expect(url.searchParams.get("zip")).toBe("11779,US");
    expect(url.searchParams.get("appid")).toBe("key&123");
  });

  it("says when a ZIP code doesn't exist", async () => {
    mockFetch(404, { cod: "404", message: "not found" });
    expect(await geocodeZip("00000")).toEqual({ ok: false, reason: "not_found" });
  });

  it("says when OpenWeather is unavailable or not set up", async () => {
    mockFetch(401, { cod: 401, message: "Invalid API key" });
    expect(await geocodeZip("11779")).toEqual({ ok: false, reason: "unavailable" });
    vi.stubEnv("OPENWEATHER_API_KEY", "");
    expect(await geocodeZip("11779")).toEqual({ ok: false, reason: "not_configured" });
  });
});

describe("getDailyForecast", () => {
  const body = { timezone_offset: -14400, daily: [{ dt: Date.parse("2026-09-29T16:00:00Z") / 1000, pop: 0.8 }] };

  it("asks One Call 3.0 for the daily forecast only, in °F, and caches it for an hour", async () => {
    const fetchMock = mockFetch(200, body);
    expect(await getDailyForecast(40.81544, -73.11234)).toEqual({
      ok: true,
      days: [{ date: "2026-09-29", rainChance: 80, summary: "", high: null, low: null }],
    });
    const url = calledUrl(fetchMock);
    expect(url.origin + url.pathname).toBe("https://api.openweathermap.org/data/3.0/onecall");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      lat: "40.82",
      lon: "-73.11",
      exclude: "current,minutely,hourly,alerts",
      units: "imperial",
      appid: "key&123",
    });
    expect(calledInit(fetchMock).next).toEqual({ revalidate: 3600 });
  });

  it("can skip the cache (for tests)", async () => {
    vi.stubEnv("OPENWEATHER_CACHE_SECONDS", "0");
    const fetchMock = mockFetch(200, body);
    await getDailyForecast(40.8, -73.1);
    expect(calledInit(fetchMock).cache).toBe("no-store");
  });

  it("says when the forecast can't be had", async () => {
    mockFetch(500, {});
    expect(await getDailyForecast(40.8, -73.1)).toEqual({ ok: false, reason: "unavailable" });
    mockFetch(200, { unexpected: true });
    expect(await getDailyForecast(40.8, -73.1)).toEqual({ ok: false, reason: "unavailable" });
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("fetch failed"))));
    expect(await getDailyForecast(40.8, -73.1)).toEqual({ ok: false, reason: "unavailable" });
  });

  it("never logs the API key", async () => {
    mockFetch(500, {});
    await getDailyForecast(40.8, -73.1);
    const logged = JSON.stringify(vi.mocked(console.error).mock.calls);
    expect(logged).not.toContain("key&123");
    expect(logged).not.toContain(encodeURIComponent("key&123"));
  });
});
