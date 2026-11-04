import { describe, expect, it } from "vitest";

import { addDays } from "@/lib/dates";

import {
  choiceLabel,
  clockLabel,
  isRainy,
  localTime,
  minutesOf,
  nextDryDay,
  parseNwsHourly,
  rainCheckDay,
  rainHoursLabel,
  rainOn,
  shortRainHoursLabel,
  spanLabel,
  timeValue,
  WORK_TIME_CHOICES,
  workdayRain,
  wetWord,
  type DayRain,
  type WorkHours,
} from "./hourly";

const NY = "America/New_York";
const WORK: WorkHours = { start: 8 * 60, end: 16 * 60 };
const MONDAY = "2026-11-09";
const pad = (n: number) => String(n).padStart(2, "0");

// One day of hourly periods in New York in November (UTC-5), as the weather service sends them.
function hoursOn(date: string, chance: (hour: number) => number, wetSummary = "Rain Likely", fromHour = 0) {
  return Array.from({ length: 24 - fromHour }, (_, i) => {
    const h = fromHour + i;
    return {
      number: i + 1,
      startTime: `${date}T${pad(h)}:00:00-05:00`,
      endTime: h === 23 ? `${addDays(date, 1)}T00:00:00-05:00` : `${date}T${pad(h + 1)}:00:00-05:00`,
      probabilityOfPrecipitation: { unitCode: "wmoUnit:percent", value: chance(h) },
      shortForecast: chance(h) >= 50 ? wetSummary : "Mostly Cloudy",
    };
  });
}
const forecast = (...days: ReturnType<typeof hoursOn>[]) => ({ properties: { periods: days.flat() } });
const rainFor = (...days: ReturnType<typeof hoursOn>[]) => workdayRain(parseNwsHourly(forecast(...days))!, WORK, NY);
const between = (from: number, to: number, wet = 80, dry = 10) => (h: number) => (h >= from && h < to ? wet : dry);

describe("parseNwsHourly", () => {
  it("reads each hour's times, chance of rain and summary", () => {
    const hours = parseNwsHourly(forecast(hoursOn(MONDAY, between(10, 14))))!;
    expect(hours).toHaveLength(24);
    expect(hours[10]).toEqual({
      start: Date.parse("2026-11-09T15:00:00Z"),
      end: Date.parse("2026-11-09T16:00:00Z"),
      rainChance: 80,
      summary: "Rain Likely",
    });
  });

  it("treats a missing chance as none and skips hours with unusable times", () => {
    const hours = parseNwsHourly({
      properties: {
        periods: [
          { startTime: "2026-11-09T10:00:00-05:00", endTime: "2026-11-09T11:00:00-05:00", probabilityOfPrecipitation: { value: null } },
          { startTime: "not a time", endTime: "2026-11-09T12:00:00-05:00" },
          { startTime: "2026-11-09T12:00:00-05:00", endTime: "2026-11-09T12:00:00-05:00" },
        ],
      },
    })!;
    expect(hours).toEqual([
      { start: Date.parse("2026-11-09T15:00:00Z"), end: Date.parse("2026-11-09T16:00:00Z"), rainChance: 0, summary: "" },
    ]);
  });

  it("refuses something that isn't an hourly forecast", () => {
    expect(parseNwsHourly({ unexpected: true })).toBeNull();
    expect(parseNwsHourly({ properties: { periods: [{ startTime: "x" }] } })).toBeNull();
    expect(parseNwsHourly({ properties: { periods: [{ startTime: "2026-11-09T10:00:00-05:00", endTime: "2026-11-09T11:00:00-05:00", probabilityOfPrecipitation: { value: 140 } }] } })).toBeNull();
  });
});

describe("rain during work hours", () => {
  it("finds when rain is likely while the crew works", () => {
    const [day] = rainFor(hoursOn(MONDAY, between(10, 14)));
    expect(day).toEqual({ date: MONDAY, windows: [{ start: 600, end: 840 }], chance: 80, covered: true, snow: false });
    expect(rainHoursLabel(day, WORK)).toBe("10am–2pm");
    expect(shortRainHoursLabel(day, WORK)).toBe("10–2");
    expect(wetWord(day)).toBe("Rain");
  });

  it("ignores rain before or after work", () => {
    const [day] = rainFor(hoursOn(MONDAY, (h) => (h < 7 || h >= 17 ? 90 : 20)));
    expect(day.windows).toEqual([]);
    expect(day.chance).toBe(20);
    expect(isRainy(day)).toBe(false);
    expect(rainHoursLabel(day, WORK)).toBe("");
  });

  it("counts 50% as likely and 49% as not", () => {
    expect(rainFor(hoursOn(MONDAY, between(9, 10, 50)))[0].windows).toEqual([{ start: 540, end: 600 }]);
    expect(rainFor(hoursOn(MONDAY, between(9, 10, 49)))[0].windows).toEqual([]);
  });

  it("clips rain to work hours and says 'all day' when it covers them", () => {
    const [day] = rainFor(hoursOn(MONDAY, between(5, 20)));
    expect(day.windows).toEqual([{ start: 480, end: 960 }]);
    expect(rainHoursLabel(day, WORK)).toBe("all day");
    expect(shortRainHoursLabel(day, WORK)).toBe("all day");
  });

  it("lists two separate showers, and spans more than two", () => {
    const two = rainFor(hoursOn(MONDAY, (h) => (h === 8 || h === 14 || h === 15 ? 70 : 0)))[0];
    expect(rainHoursLabel(two, WORK)).toBe("8–9am, 2–4pm");
    expect(shortRainHoursLabel(two, WORK)).toBe("8–9+");
    const three = rainFor(hoursOn(MONDAY, (h) => (h === 8 || h === 11 || h === 14 ? 70 : 0)))[0];
    expect(rainHoursLabel(three, WORK)).toBe("8am–3pm");
  });

  it("uses work hours that start or end on the half hour", () => {
    const [day] = workdayRain(parseNwsHourly(forecast(hoursOn(MONDAY, between(8, 9))))!, { start: 510, end: 900 }, NY);
    expect(day.windows).toEqual([{ start: 510, end: 540 }]);
    expect(rainHoursLabel(day, { start: 510, end: 900 })).toBe("8:30–9am");
  });

  it("puts each hour on the business's own clock, whatever offset the times are written in", () => {
    const hours = parseNwsHourly({
      properties: {
        periods: [{ startTime: "2026-11-09T15:00:00Z", endTime: "2026-11-09T16:00:00Z", probabilityOfPrecipitation: { value: 90 } }],
      },
    })!;
    expect(workdayRain(hours, WORK, NY)[0]).toMatchObject({ date: MONDAY, windows: [{ start: 600, end: 660 }] });
    // The same hour is 7am in Los Angeles: before work.
    expect(workdayRain(hours, WORK, "America/Los_Angeles")).toEqual([]);
  });

  it("knows when the forecast doesn't cover the whole work day", () => {
    const days = rainFor(hoursOn(MONDAY, () => 0, "", 11), hoursOn(addDays(MONDAY, 1), () => 0));
    expect(days.map((d) => [d.date, d.covered])).toEqual([
      [MONDAY, false],
      [addDays(MONDAY, 1), true],
    ]);
  });

  it("calls it snow when every wet hour is snow", () => {
    expect(wetWord(rainFor(hoursOn(MONDAY, between(9, 12), "Snow Likely"))[0])).toBe("Snow");
    expect(wetWord(rainFor(hoursOn(MONDAY, between(9, 12), "Rain And Snow"))[0])).toBe("Rain");
  });
});

describe("the automatic rain check", () => {
  const at = (local: string) => Date.parse(`${local}-05:00`);

  it("is about today before work, and tomorrow after work", () => {
    expect(rainCheckDay(at("2026-11-09T06:30:00"), NY, WORK)).toBe(MONDAY);
    expect(rainCheckDay(at("2026-11-09T07:59:00"), NY, WORK)).toBe(MONDAY);
    expect(rainCheckDay(at("2026-11-09T08:00:00"), NY, WORK)).toBeNull();
    expect(rainCheckDay(at("2026-11-09T15:59:00"), NY, WORK)).toBeNull();
    expect(rainCheckDay(at("2026-11-09T16:00:00"), NY, WORK)).toBe("2026-11-10");
    expect(rainCheckDay(at("2026-11-09T23:30:00"), NY, WORK)).toBe("2026-11-10");
  });

  it("leaves Sunday alone, and checks Monday on Sunday evening", () => {
    expect(rainCheckDay(at("2026-11-07T18:00:00"), NY, WORK)).toBeNull(); // Saturday evening
    expect(rainCheckDay(at("2026-11-08T07:00:00"), NY, WORK)).toBeNull(); // Sunday morning
    expect(rainCheckDay(at("2026-11-08T12:00:00"), NY, WORK)).toBeNull();
    expect(rainCheckDay(at("2026-11-08T18:00:00"), NY, WORK)).toBe(MONDAY);
  });

  it("follows the business's own work hours", () => {
    expect(rainCheckDay(at("2026-11-09T06:30:00"), NY, { start: 6 * 60, end: 14 * 60 })).toBeNull();
    expect(rainCheckDay(at("2026-11-09T14:30:00"), NY, { start: 6 * 60, end: 14 * 60 })).toBe("2026-11-10");
  });

  it("moves visits to the next day that isn't wet, never a Sunday", () => {
    const wet = (date: string): DayRain => ({ date, windows: [{ start: 600, end: 720 }], chance: 80, covered: true, snow: false });
    const dry = (date: string): DayRain => ({ date, windows: [], chance: 10, covered: true, snow: false });
    expect(nextDryDay(MONDAY, [wet(MONDAY), dry("2026-11-10")])).toBe("2026-11-10");
    expect(nextDryDay(MONDAY, [wet(MONDAY), wet("2026-11-10"), dry("2026-11-11")])).toBe("2026-11-11");
    expect(nextDryDay("2026-11-07", [wet("2026-11-07"), dry("2026-11-09")])).toBe(MONDAY);
    // Past the end of the forecast counts as dry.
    expect(nextDryDay(MONDAY, [wet(MONDAY), wet("2026-11-10")])).toBe("2026-11-11");
    // A whole wet week: the next work day.
    const week = Array.from({ length: 8 }, (_, i) => wet(addDays(MONDAY, i)));
    expect(nextDryDay(MONDAY, week)).toBe("2026-11-10");
    expect(nextDryDay("2026-11-07", week)).toBe(MONDAY);
  });

  it("finds a day in the list", () => {
    const days = rainFor(hoursOn(MONDAY, between(10, 14)));
    expect(rainOn(days, MONDAY)?.date).toBe(MONDAY);
    expect(rainOn(days, "2026-11-10")).toBeUndefined();
  });
});

describe("times", () => {
  it("reads times as the database sends them", () => {
    expect(minutesOf("08:00:00")).toBe(480);
    expect(minutesOf("16:30")).toBe(990);
    expect(minutesOf("8:00")).toBeNull();
    expect(minutesOf("24:00:00")).toBeNull();
    expect(minutesOf(undefined)).toBeNull();
    expect(timeValue(480)).toBe("08:00");
    expect(timeValue(990)).toBe("16:30");
  });

  it("writes times the way people say them", () => {
    expect([0, 480, 630, 720, 780, 1290].map((m) => clockLabel(m))).toEqual(["12am", "8am", "10:30am", "12pm", "1pm", "9:30pm"]);
    expect(spanLabel(600, 660)).toBe("10–11am");
    expect(spanLabel(600, 840)).toBe("10am–2pm");
    expect(spanLabel(780, 960)).toBe("1–4pm");
    expect(spanLabel(660, 720)).toBe("11am–12pm");
    expect(choiceLabel(480)).toBe("8:00 AM");
    expect(choiceLabel(1290)).toBe("9:30 PM");
    expect(WORK_TIME_CHOICES[0]).toBe(240);
    expect(WORK_TIME_CHOICES.at(-1)).toBe(1320);
    expect(WORK_TIME_CHOICES).toContain(480);
  });

  it("places moments on the business's calendar, across the clocks changing", () => {
    expect(localTime(Date.parse("2026-11-09T04:30:00Z"), NY)).toEqual({ date: "2026-11-08", minutes: 23 * 60 + 30 });
    // Clocks went back at 2am on Sunday, Nov 1: 1:30am happened twice.
    expect(localTime(Date.parse("2026-11-01T01:30:00-04:00"), NY)).toEqual({ date: "2026-11-01", minutes: 90 });
    expect(localTime(Date.parse("2026-11-01T01:30:00-05:00"), NY)).toEqual({ date: "2026-11-01", minutes: 90 });
    expect(localTime(Date.parse("2026-11-09T05:00:00Z"), NY)).toEqual({ date: MONDAY, minutes: 0 });
  });
});
