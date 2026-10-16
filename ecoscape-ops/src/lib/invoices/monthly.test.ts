import { describe, expect, it } from "vitest";

import { describeRun, monthlyOptions, parseBillingMonth } from "./monthly";

describe("monthly invoices", () => {
  it("offers this month and the previous ones, across a year boundary", () => {
    expect(monthlyOptions("2031-01-15", 3)).toEqual(["2031-01-01", "2030-12-01", "2030-11-01"]);
  });
  it("accepts only a real first-of-month that has started", () => {
    expect(parseBillingMonth("2031-03-01", "2031-03-15")).toBe("2031-03-01");
    expect(parseBillingMonth("2031-02-01", "2031-03-15")).toBe("2031-02-01");
    expect(parseBillingMonth("2031-04-01", "2031-03-15")).toBeNull();
    expect(parseBillingMonth("2031-03-05", "2031-03-15")).toBeNull();
    expect(parseBillingMonth("2031-02-30", "2031-03-15")).toBeNull();
    expect(parseBillingMonth("junk", "2031-03-15")).toBeNull();
    expect(parseBillingMonth(null, "2031-03-15")).toBeNull();
  });
  it("describes what happened", () => {
    expect(describeRun(0, 0, 0)).toContain("Nothing to bill");
    expect(describeRun(2, 0, 5)).toBe("2 draft invoices made, covering 5 visits. Review them, then send.");
    expect(describeRun(1, 1, 1)).toBe("1 draft invoice made and 1 existing draft updated, covering 1 visit. Review them, then send.");
  });
});
