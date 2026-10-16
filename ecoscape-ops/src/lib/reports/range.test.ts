import { describe, expect, it } from "vitest";

import { defaultRange, parseRange, presets } from "./range";

const today = "2030-04-15";

describe("report ranges", () => {
  it("defaults to the month so far", () => {
    expect(defaultRange(today)).toEqual({ from: "2030-04-01", to: today });
    expect(parseRange({}, today)).toEqual(defaultRange(today));
  });
  it("accepts a valid range", () => {
    expect(parseRange({ from: "2030-01-01", to: "2030-03-31" }, today)).toEqual({ from: "2030-01-01", to: "2030-03-31" });
  });
  it("falls back for junk, reversed, impossible or huge ranges", () => {
    for (const p of [
      { from: "nope", to: "2030-03-31" },
      { from: "2030-03-31", to: "2030-01-01" },
      { from: "2030-02-30", to: "2030-03-01" },
      { from: "2000-01-01", to: "2030-01-01" },
      { from: ["2030-01-01", "2030-01-02"], to: "2030-03-01" },
    ]) {
      expect(parseRange(p, today)).toEqual(defaultRange(today));
    }
  });
  it("offers presets, including across a year boundary", () => {
    const p = Object.fromEntries(presets("2030-01-10").map((x) => [x.key, x.range]));
    expect(p["last-month"]).toEqual({ from: "2029-12-01", to: "2029-12-31" });
    expect(p["last-year"]).toEqual({ from: "2029-01-01", to: "2029-12-31" });
    expect(p.year).toEqual({ from: "2030-01-01", to: "2030-01-10" });
  });
});
