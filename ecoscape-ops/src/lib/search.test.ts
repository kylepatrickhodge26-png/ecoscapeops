import { describe, expect, it } from "vitest";

import { cleanSearchTerm, groupHits, hitHref, type SearchHit } from "./search";

const hit = (kind: string, id: string): SearchHit => ({ kind, id, title: id, detail: null, on_date: null, status: null, amount: null, number: null });

describe("search", () => {
  it("cleans what was typed", () => {
    expect(cleanSearchTerm("  Alice   Ames ")).toBe("Alice Ames");
    expect(cleanSearchTerm(["a", "b"])).toBe("");
    expect(cleanSearchTerm(undefined)).toBe("");
    expect(cleanSearchTerm("x".repeat(500))).toHaveLength(100);
  });

  it("groups results in a fixed order and drops empty groups", () => {
    const groups = groupHits([hit("invoice", "i1"), hit("customer", "c1"), hit("customer", "c2"), hit("mystery", "m1")]);
    expect(groups.map((g) => [g.kind, g.hits.map((h) => h.id)])).toEqual([
      ["customer", ["c1", "c2"]],
      ["invoice", ["i1"]],
    ]);
  });

  it("links each kind to its page", () => {
    expect(hitHref({ kind: "customer", id: "1" })).toBe("/customers/1");
    expect(hitHref({ kind: "visit", id: "2" })).toBe("/schedule/jobs/2");
    expect(hitHref({ kind: "quote", id: "3" })).toBe("/quotes/3");
    expect(hitHref({ kind: "invoice", id: "4" })).toBe("/invoices/4");
    expect(hitHref({ kind: "request", id: "5" })).toBe("/requests");
  });
});
