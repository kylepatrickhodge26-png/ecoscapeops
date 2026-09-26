import { describe, expect, it } from "vitest";

import {
  addDays,
  addMonths,
  formatLongDate,
  formatMonth,
  formatShortDate,
  isISODate,
  isISOMonth,
  monthGrid,
  nextWeekdayOnOrAfter,
  weekdayOf,
} from "./dates";

describe("date helpers", () => {
  it("adds days across month, year, and daylight-saving boundaries", () => {
    expect(addDays("2026-09-29", 7)).toBe("2026-10-06");
    expect(addDays("2026-12-29", 7)).toBe("2027-01-05");
    expect(addDays("2026-11-01", 1)).toBe("2026-11-02"); // US clocks change this day
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });

  it("finds the next given weekday on or after a date", () => {
    expect(weekdayOf("2026-09-26")).toBe(6); // Saturday
    expect(nextWeekdayOnOrAfter("2026-09-26", 2)).toBe("2026-09-29"); // next Tuesday
    expect(nextWeekdayOnOrAfter("2026-09-29", 2)).toBe("2026-09-29"); // already Tuesday
  });

  it("validates dates and months", () => {
    expect(isISODate("2026-09-29")).toBe(true);
    expect(isISODate("2026-02-30")).toBe(false);
    expect(isISODate("09/29/2026")).toBe(false);
    expect(isISOMonth("2026-09")).toBe(true);
    expect(isISOMonth("2026-13")).toBe(false);
  });

  it("formats dates without shifting them by time zone", () => {
    expect(formatShortDate("2026-09-29")).toBe("Tue, Sep 29");
    expect(formatLongDate("2026-09-29")).toBe("Tuesday, September 29, 2026");
    expect(formatMonth("2026-09")).toBe("September 2026");
  });

  it("steps months, including across years", () => {
    expect(addMonths("2026-12", 1)).toBe("2027-01");
    expect(addMonths("2026-01", -1)).toBe("2025-12");
  });

  it("builds a Sunday-first month grid padded with neighbouring days", () => {
    const weeks = monthGrid("2026-09"); // Sep 1 2026 is a Tuesday; Sep 30 a Wednesday
    expect(weeks).toHaveLength(5);
    expect(weeks[0]).toEqual([
      "2026-08-30",
      "2026-08-31",
      "2026-09-01",
      "2026-09-02",
      "2026-09-03",
      "2026-09-04",
      "2026-09-05",
    ]);
    expect(weeks.at(-1)!.at(-1)).toBe("2026-10-03");
    expect(weeks.every((w) => w.length === 7 && weekdayOf(w[0]) === 0)).toBe(true);

    expect(monthGrid("2026-02")).toHaveLength(4); // Feb 2026 starts on a Sunday, 28 days
  });
});
