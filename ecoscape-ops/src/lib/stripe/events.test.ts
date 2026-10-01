import { describe, expect, it } from "vitest";

import { checkoutOutcome, toCents } from "./events";

describe("checkoutOutcome", () => {
  it.each([
    ["checkout.session.completed", "paid", "paid"],
    ["checkout.session.completed", "unpaid", "processing"],
    ["checkout.session.completed", "no_payment_required", null],
    ["checkout.session.async_payment_succeeded", "paid", "paid_later"],
    ["checkout.session.async_payment_failed", "unpaid", "failed"],
    ["checkout.session.expired", "unpaid", "expired"],
    ["payment_intent.succeeded", "paid", null],
    ["account.updated", undefined, null],
  ])("%s with payment status %s → %s", (type, status, outcome) => {
    expect(checkoutOutcome(type, status)).toBe(outcome);
  });
});

describe("toCents", () => {
  it.each([
    [65, 6500],
    [19.99, 1999],
    [0.1 + 0.2, 30],
    [127.5, 12750],
    [1234.56, 123456],
  ])("%s dollars is %s cents", (dollars, cents) => {
    expect(toCents(dollars)).toBe(cents);
  });
});
