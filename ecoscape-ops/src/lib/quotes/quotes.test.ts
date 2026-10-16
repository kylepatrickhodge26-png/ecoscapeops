import { describe, expect, it } from "vitest";

import { acceptSchema, quoteSchema } from "./schema";
import { isQuoteStatus, quoteNumber } from "./constants";
import { quoteWho } from "./display";
import { quoteText } from "./text";

const base = {
  customer_id: "",
  prospect_name: "Jane Doe",
  prospect_phone: "631-555-0100",
  prospect_email: "jane@example.com",
  prospect_address: "12 Oak St",
  title: "Spring cleanup",
  expires_on: "2026-11-15",
  notes: "",
  lines: [{ description: "Cleanup", quantity: "1", unit_price: "250" }],
};

describe("quote form validation", () => {
  it("accepts a prospect quote and turns amounts into numbers", () => {
    const r = quoteSchema.safeParse(base);
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.lines[0]).toMatchObject({ quantity: 1, unit_price: 250 });
  });

  it("needs a customer or a prospect name", () => {
    const r = quoteSchema.safeParse({ ...base, prospect_name: "  " });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0].path).toEqual(["prospect_name"]);
  });

  it("doesn't need prospect details when a customer is chosen", () => {
    const id = "6f4c1a52-3e7b-4a63-8d2a-0b9d6a1c7e11";
    expect(quoteSchema.safeParse({ ...base, customer_id: id, prospect_name: "", prospect_email: "nope" }).success).toBe(true);
  });

  it("rejects a bad prospect email", () => {
    expect(quoteSchema.safeParse({ ...base, prospect_email: "jane@" }).success).toBe(false);
  });

  it("needs at least one line, a real price, and a total between $0.01 and $99,999.99", () => {
    expect(quoteSchema.safeParse({ ...base, lines: [] }).success).toBe(false);
    expect(quoteSchema.safeParse({ ...base, lines: [{ description: "x", quantity: "1", unit_price: "abc" }] }).success).toBe(false);
    expect(quoteSchema.safeParse({ ...base, lines: [{ description: "Free", quantity: "1", unit_price: "0" }] }).success).toBe(false);
    const big = quoteSchema.safeParse({ ...base, lines: [{ description: "Big", quantity: "9999", unit_price: "99999" }] });
    expect(big.success).toBe(false);
    if (!big.success) expect(big.error.issues.some((i) => i.message.includes("99,999.99"))).toBe(true);
  });

  it("rejects an expiry that isn't a date", () => {
    expect(quoteSchema.safeParse({ ...base, expires_on: "soon" }).success).toBe(false);
  });
});

describe("accepting a quote", () => {
  const ok = { service_name: "Spring cleanup", frequency: "weekly", first_visit: "2026-10-20", assigned_crew_member_id: "" };
  it("takes a service name, how often, and the first visit", () => {
    expect(acceptSchema.safeParse(ok).success).toBe(true);
    expect(acceptSchema.safeParse({ ...ok, service_name: " " }).success).toBe(false);
    expect(acceptSchema.safeParse({ ...ok, frequency: "daily" }).success).toBe(false);
    expect(acceptSchema.safeParse({ ...ok, first_visit: "tomorrow" }).success).toBe(false);
  });
});

describe("quote text and names", () => {
  const quote = {
    number: 1001,
    title: "Spring cleanup",
    expires_on: "2026-11-15",
    notes: "Includes disposal.",
    total: 371.5,
    lines: [
      { description: "Spring cleanup", quantity: 1, unit_price: 250, amount: 250 },
      { description: "Mulch", quantity: 3, unit_price: 40.5, amount: 121.5 },
    ],
  };

  it("writes a plain-text quote to paste", () => {
    const text = quoteText(quote, { greeting: "Jane", businessName: "Acme Lawn" });
    expect(text).toContain("Hi Jane, here's your quote Q-1001 from Acme Lawn for Spring cleanup:");
    expect(text).toContain("- Spring cleanup: $250.00");
    expect(text).toContain("- Mulch (3 x $40.50): $121.50");
    expect(text).toContain("Total: $371.50");
    expect(text).toContain("Includes disposal.");
  });

  it("works without a greeting or title", () => {
    const text = quoteText({ ...quote, title: "", notes: "" }, { greeting: null, businessName: "Acme Lawn" });
    expect(text.startsWith("Here's your quote Q-1001 from Acme Lawn:")).toBe(true);
    expect(text).not.toContain("Includes disposal.");
  });

  it("names the customer or the prospect", () => {
    expect(quoteWho({ prospect_name: "Pat", customer: null })).toBe("Pat");
    expect(quoteWho({ prospect_name: "", customer: { first_name: "Al", last_name: "Lee", phone: "", email: "" } })).toBe("Al Lee");
  });

  it("numbers and statuses", () => {
    expect(quoteNumber(1001)).toBe("Q-1001");
    expect(isQuoteStatus("expired")).toBe(true);
    expect(isQuoteStatus("paid")).toBe(false);
  });
});
