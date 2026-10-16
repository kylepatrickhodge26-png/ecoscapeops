import { describe, expect, it } from "vitest";

import { formatClock, formatHours, localInputToTimestamp, toLocalInput } from "./format";

describe("time formatting", () => {
  it("formats hours", () => {
    expect(formatHours(1.5)).toBe("1.5 h");
    expect(formatHours(2)).toBe("2 h");
    expect(formatHours(0.25)).toBe("0.25 h");
  });
  it("shows a moment on the business's clock, across daylight saving", () => {
    expect(formatClock("2030-07-01T13:02:00Z", "America/New_York")).toBe("9:02 AM");
    expect(formatClock("2030-01-01T14:02:00Z", "America/New_York")).toBe("9:02 AM");
    expect(toLocalInput("2030-07-01T13:02:00Z", "America/New_York")).toBe("2030-07-01T09:02");
    expect(toLocalInput("2030-01-01T14:02:00Z", "America/New_York")).toBe("2030-01-01T09:02");
    expect(toLocalInput("2030-07-01T04:30:00Z", "America/New_York")).toBe("2030-07-01T00:30");
  });
  it("turns a datetime-local value into a plain timestamp, rejecting junk", () => {
    expect(localInputToTimestamp("2030-07-01T09:02")).toBe("2030-07-01 09:02:00");
    for (const bad of ["", "2030-07-01", "2030-07-01T9:02", "2030-13-01T09:02", "2030-07-01T09:02:00Z", null, undefined, 5]) {
      expect(localInputToTimestamp(bad)).toBeNull();
    }
  });
});
