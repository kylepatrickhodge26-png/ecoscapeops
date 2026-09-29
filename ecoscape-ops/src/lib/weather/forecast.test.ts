import { describe, expect, it } from "vitest";

import { dayLabel, parseNwsForecast, riskWindow, topRainRisk, type ForecastDay } from "./forecast";

const day = (date: string, rainChance: number): ForecastDay => ({ date, rainChance, summary: "", high: null, low: null });

// A National Weather Service forecast period.
const period = (startTime: string, isDaytime: boolean, pop: number | null, temperature: number, shortForecast: string) => ({
  number: 1,
  name: isDaytime ? "Today" : "Tonight",
  startTime,
  endTime: startTime,
  isDaytime,
  temperature,
  temperatureUnit: "F",
  probabilityOfPrecipitation: { unitCode: "wmoUnit:percent", value: pop },
  windSpeed: "5 mph",
  windDirection: "SW",
  shortForecast,
  detailedForecast: "",
});

describe("parseNwsForecast", () => {
  it("folds day and night periods into one entry per date", () => {
    const days = parseNwsForecast({
      type: "Feature",
      properties: {
        units: "us",
        periods: [
          period("2026-09-28T10:00:00-04:00", true, 10, 72, "Mostly Sunny"),
          period("2026-09-28T18:00:00-04:00", false, 20, 55, "Partly Cloudy"),
          period("2026-09-29T06:00:00-04:00", true, 80, 64, "Showers And Thunderstorms"),
          period("2026-09-29T18:00:00-04:00", false, 40, 58, "Chance Showers"),
          period("2026-09-30T06:00:00-04:00", true, null, 70, "Sunny"),
        ],
      },
    });
    expect(days).toEqual([
      { date: "2026-09-28", rainChance: 20, summary: "Mostly Sunny", high: 72, low: 55 },
      { date: "2026-09-29", rainChance: 80, summary: "Showers And Thunderstorms", high: 64, low: 58 },
      { date: "2026-09-30", rainChance: 0, summary: "Sunny", high: 70, low: null },
    ]);
  });

  it("copes with a forecast that starts tonight", () => {
    const days = parseNwsForecast({
      properties: {
        periods: [
          period("2026-09-28T18:00:00-04:00", false, 60, 55, "Rain Likely"),
          period("2026-09-29T06:00:00-04:00", true, 30, 66, "Chance Rain"),
        ],
      },
    });
    expect(days).toEqual([
      { date: "2026-09-28", rainChance: 60, summary: "Rain Likely", high: null, low: 55 },
      { date: "2026-09-29", rainChance: 30, summary: "Chance Rain", high: 66, low: null },
    ]);
  });

  it("uses each period's own local date, wherever the business is", () => {
    // Late evening in Hawaii is already the next day in UTC.
    const days = parseNwsForecast({
      properties: { periods: [period("2026-12-31T18:00:00-10:00", false, 50, 70, "Showers")] },
    });
    expect(days?.[0].date).toBe("2026-12-31");
  });

  it.each([
    ["nothing", null],
    ["an error body", { title: "Data Unavailable For Requested Point", status: 404 }],
    ["a malformed period", { properties: { periods: [{ isDaytime: true }] } }],
    ["an impossible rain chance", { properties: { periods: [period("2026-09-28T06:00:00-04:00", true, 170, 70, "")] } }],
  ])("rejects %s", (_label, json) => {
    expect(parseNwsForecast(json)).toBeNull();
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
