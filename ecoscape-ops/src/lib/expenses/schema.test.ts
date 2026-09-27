import { describe, expect, it } from "vitest";

import { EXPENSE_CATEGORIES, EXPENSE_CATEGORY_LABELS, parseExpense, quickLogSchema } from "./schema";

const valid = { spent_on: "2026-09-26", category: "fuel", amount: "62.40", vendor: " Speedway ", notes: "" };

describe("expense validation", () => {
  it("accepts a complete expense and trims text", () => {
    const result = parseExpense(valid);
    expect(result).toEqual({
      success: true,
      data: { spent_on: "2026-09-26", category: "fuel", amount: 62.4, vendor: "Speedway", notes: "" },
    });
  });

  it.each([
    ["", "Enter an amount like 62.40"],
    ["0", "The amount must be more than $0"],
    ["-5", "Enter an amount like 62.40"],
    ["12.345", "Enter an amount like 62.40"],
    ["1000000", "Enter an amount like 62.40"],
    ["abc", "Enter an amount like 62.40"],
  ])("rejects the amount %j", (amount, message) => {
    expect(parseExpense({ ...valid, amount })).toMatchObject({ success: false, fieldErrors: { amount: message } });
  });

  it("rejects unknown categories and bad dates", () => {
    const result = parseExpense({ ...valid, category: "yacht", spent_on: "2026-02-30" });
    expect(!result.success && Object.keys(result.fieldErrors).sort()).toEqual(["category", "spent_on"]);
  });

  it("has a label for every one of the 11 categories", () => {
    expect(EXPENSE_CATEGORIES).toHaveLength(11);
    for (const c of EXPENSE_CATEGORIES) expect(EXPENSE_CATEGORY_LABELS[c]).toBeTruthy();
  });

  it("quick-log needs only an amount", () => {
    expect(quickLogSchema.safeParse({ amount: "45", vendor: "" }).success).toBe(true);
    expect(quickLogSchema.safeParse({ amount: "", vendor: "Shell" }).success).toBe(false);
  });
});
