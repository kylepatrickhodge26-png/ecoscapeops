import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { getDailyForecast, getHourlyForecast } from "./nws";

const FORECAST_URL = "https://api.weather.gov/gridpoints/OKX/72,55/forecast";
const HOURLY_URL = "https://api.weather.gov/gridpoints/OKX/72,55/forecast/hourly";
const points = {
  properties: { forecast: FORECAST_URL, forecastHourly: HOURLY_URL, relativeLocation: { properties: { city: "Ronkonkoma", state: "NY" } } },
};
const forecast = {
  properties: {
    periods: [
      { startTime: "2026-09-29T06:00:00-04:00", isDaytime: true, temperature: 64, probabilityOfPrecipitation: { value: 80 }, shortForecast: "Showers" },
    ],
  },
};

type Call = [string, RequestInit & { next?: { revalidate: number } }];

// Answers /points and then the forecast link, like the real service.
function mockNws(pointsResponse: [number, unknown], forecastResponse: [number, unknown] = [200, forecast]) {
  const fetchMock = vi.fn(async (url: string) => {
    const [status, body] = url.includes("/points/") ? pointsResponse : forecastResponse;
    return new Response(JSON.stringify(body), { status });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}
const calls = (fetchMock: ReturnType<typeof mockNws>) => fetchMock.mock.calls as unknown as Call[];

beforeEach(() => {
  vi.stubEnv("NWS_BASE_URL", "");
  vi.stubEnv("WEATHER_CACHE_SECONDS", "");
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("getDailyForecast", () => {
  it("looks up the location's forecast link, then the forecast", async () => {
    const fetchMock = mockNws([200, points]);
    expect(await getDailyForecast(40.80834, -73.13051)).toEqual({
      ok: true,
      days: [{ date: "2026-09-29", rainChance: 80, summary: "Showers", high: 64, low: null }],
    });
    const [[pointsUrl], [forecastUrl]] = calls(fetchMock);
    expect(pointsUrl).toBe("https://api.weather.gov/points/40.8083,-73.1305");
    expect(forecastUrl).toBe(FORECAST_URL);
  });

  it("identifies itself, as the weather service asks, and caches what it gets", async () => {
    const fetchMock = mockNws([200, points]);
    await getDailyForecast(40.8, -73.1);
    const [[, pointsInit], [, forecastInit]] = calls(fetchMock);
    for (const init of [pointsInit, forecastInit]) {
      expect((init.headers as Record<string, string>)["User-Agent"]).toMatch(/^EcoScape Ops \(/);
    }
    expect(pointsInit.next).toEqual({ revalidate: 86_400 });
    expect(forecastInit.next).toEqual({ revalidate: 3600 });
  });

  it("can skip the cache (for tests)", async () => {
    vi.stubEnv("WEATHER_CACHE_SECONDS", "0");
    const fetchMock = mockNws([200, points]);
    await getDailyForecast(40.8, -73.1);
    for (const [, init] of calls(fetchMock)) expect(init.cache).toBe("no-store");
  });

  it("says so when the location isn't covered or the service is down", async () => {
    mockNws([404, { title: "Data Unavailable For Requested Point", status: 404 }]);
    expect(await getDailyForecast(51.5, -0.1)).toEqual({ ok: false });
    mockNws([200, points], [500, { title: "Unexpected Problem" }]);
    expect(await getDailyForecast(40.8, -73.1)).toEqual({ ok: false });
    mockNws([200, points], [200, { unexpected: true }]);
    expect(await getDailyForecast(40.8, -73.1)).toEqual({ ok: false });
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("fetch failed"))));
    expect(await getDailyForecast(40.8, -73.1)).toEqual({ ok: false });
  });

  it("never follows a forecast link that points anywhere but the weather service", async () => {
    const fetchMock = mockNws([200, { properties: { forecast: "https://evil.example.com/forecast" } }]);
    expect(await getDailyForecast(40.8, -73.1)).toEqual({ ok: false });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("getHourlyForecast", () => {
  const hourly = {
    properties: {
      periods: [
        { startTime: "2026-11-09T10:00:00-05:00", endTime: "2026-11-09T11:00:00-05:00", probabilityOfPrecipitation: { value: 70 }, shortForecast: "Rain Likely" },
      ],
    },
  };

  it("follows the location's hourly link and reads each hour", async () => {
    const fetchMock = mockNws([200, points], [200, hourly]);
    expect(await getHourlyForecast(40.80834, -73.13051)).toEqual({
      ok: true,
      hours: [{ start: Date.parse("2026-11-09T15:00:00Z"), end: Date.parse("2026-11-09T16:00:00Z"), rainChance: 70, summary: "Rain Likely" }],
    });
    const [[pointsUrl, pointsInit], [hourlyUrl, hourlyInit]] = calls(fetchMock);
    expect(pointsUrl).toBe("https://api.weather.gov/points/40.8083,-73.1305");
    expect(hourlyUrl).toBe(HOURLY_URL);
    expect((hourlyInit.headers as Record<string, string>)["User-Agent"]).toMatch(/^EcoScape Ops \(/);
    expect(pointsInit.next).toEqual({ revalidate: 86_400 });
    expect(hourlyInit.next).toEqual({ revalidate: 3600 });
  });

  it("says so when there's no hourly forecast or it can't be read", async () => {
    mockNws([200, { properties: { forecast: FORECAST_URL } }]);
    expect(await getHourlyForecast(40.8, -73.1)).toEqual({ ok: false });
    mockNws([200, points], [503, { title: "Service Unavailable" }]);
    expect(await getHourlyForecast(40.8, -73.1)).toEqual({ ok: false });
    mockNws([200, points], [200, { properties: { periods: "soon" } }]);
    expect(await getHourlyForecast(40.8, -73.1)).toEqual({ ok: false });
  });

  it("never follows an hourly link that points anywhere but the weather service", async () => {
    const fetchMock = mockNws([200, { properties: { forecastHourly: "https://evil.example.com/hourly" } }]);
    expect(await getHourlyForecast(40.8, -73.1)).toEqual({ ok: false });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
