import { describe, expect, it } from "vitest";

import { dayLabel, parseOneCall, riskWindow, topRainRisk, type ForecastDay } from "./forecast";

// Local noon on a date, as OpenWeather's daily "dt" gives it, for a UTC offset in seconds.
const localNoon = (date: string, offset: number) => Date.parse(`${date}T12:00:00Z`) / 1000 - offset;

const day = (date: string, rainChance: number): ForecastDay => ({ date, rainChance, summary: "", high: null, low: null });

describe("parseOneCall", () => {
  it("reads each day's date, rain chance, summary, and temperatures", () => {
    const offset = -14400; // New York in summer
    const days = parseOneCall({
      lat: 40.82,
      lon: -73.11,
      timezone: "America/New_York",
      timezone_offset: offset,
      daily: [
        {
          dt: localNoon("2026-09-28", offset),
          pop: 0.1,
          summary: "Expect a day of partly cloudy with clear spells",
          temp: { day: 70.2, min: 55.4, max: 72.6 },
          weather: [{ id: 802, main: "Clouds", description: "scattered clouds", icon: "03d" }],
        },
        {
          dt: localNoon("2026-09-29", offset),
          pop: 0.834,
          temp: { min: 58, max: 64.4 },
          weather: [{ id: 501, main: "Rain", description: "moderate rain", icon: "10d" }],
        },
        { dt: localNoon("2026-09-30", offset) },
      ],
    });
    expect(days).toEqual([
      { date: "2026-09-28", rainChance: 10, summary: "Expect a day of partly cloudy with clear spells", high: 73, low: 55 },
      { date: "2026-09-29", rainChance: 83, summary: "Moderate rain", high: 64, low: 58 },
      { date: "2026-09-30", rainChance: 0, summary: "", high: null, low: null },
    ]);
  });

  it.each([
    ["Tokyo", 32400],
    ["Honolulu", -36000],
    ["Kiritimati", 50400],
  ])("puts each day on the right date in %s", (_place, offset) => {
    const days = parseOneCall({ timezone_offset: offset, daily: [{ dt: localNoon("2026-12-31", offset), pop: 0.5 }] });
    expect(days?.[0].date).toBe("2026-12-31");
  });

  it.each([
    ["nothing", null],
    ["an error body", { cod: 401, message: "Invalid API key" }],
    ["a malformed day", { timezone_offset: 0, daily: [{ pop: 0.5 }] }],
    ["an impossible rain chance", { timezone_offset: 0, daily: [{ dt: 0, pop: 7 }] }],
  ])("rejects %s", (_label, json) => {
    expect(parseOneCall(json)).toBeNull();
  });
});

describe("topRainRisk", () => {
  const today = "2026-09-28";

  it("picks the rainiest of today and the next two days", () => {
    const days = [day("2026-09-28", 10), day("2026-09-29", 80), day("2026-09-30", 30), day("2026-10-01", 95)];
    expect(topRainRisk(days, today)).toEqual(day("2026-09-29", 80));
  });

  it("picks the earliest day on a tie", () => {
    const days = [day("2026-09-28", 40), day("2026-09-29", 60), day("2026-09-30", 60)];
    expect(topRainRisk(days, today)?.date).toBe("2026-09-29");
  });

  it("still answers when every day is dry", () => {
    const days = [day("2026-09-28", 0), day("2026-09-29", 0), day("2026-09-30", 0)];
    expect(topRainRisk(days, today)).toEqual(day("2026-09-28", 0));
  });

  it("ignores days before today (a forecast fetched yesterday)", () => {
    const days = [day("2026-09-27", 100), day("2026-09-28", 20), day("2026-09-29", 30)];
    expect(topRainRisk(days, today)).toEqual(day("2026-09-29", 30));
    expect(riskWindow(days, today).map((d) => d.date)).toEqual(["2026-09-28", "2026-09-29"]);
  });

  it("is null when the forecast doesn't cover the next three days", () => {
    expect(topRainRisk([], today)).toBeNull();
    expect(topRainRisk([day("2026-10-05", 90)], today)).toBeNull();
  });
});

describe("dayLabel", () => {
  it("says today, tomorrow, or the date", () => {
    expect(dayLabel("2026-09-28", "2026-09-28")).toBe("today");
    expect(dayLabel("2026-09-29", "2026-09-28")).toBe("tomorrow");
    expect(dayLabel("2026-09-30", "2026-09-28")).toBe("Wed, Sep 30");
  });
});
