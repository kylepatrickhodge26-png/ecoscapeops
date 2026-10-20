import { describe, expect, it } from "vitest";

import { HELP_TOPICS, helpFor, helpSections, searchHelp } from "./help";

describe("help", () => {
  it("gives every topic a unique link and an answer", () => {
    const ids = HELP_TOPICS.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const t of HELP_TOPICS) {
      expect(t.id).toMatch(/^[a-z0-9-]+$/);
      expect(t.question.endsWith("?")).toBe(true);
      expect(t.answer.length).toBeGreaterThan(0);
      expect(t.for.length).toBeGreaterThan(0);
    }
  });

  it("shows crew only crew topics: nothing about invoices, quotes, customers or crew admin", () => {
    const crew = helpFor("crew").map((t) => t.id);
    expect(crew).toContain("clock-in");
    expect(crew).toContain("forgot-clock-out-crew");
    for (const ownerOnly of ["invoice", "get-paid", "quote", "reports", "add-crew", "payroll", "find", "customer-faq", "forgot-clock-out-owner"]) {
      expect(crew).not.toContain(ownerOnly);
    }
    expect(helpFor("owner").map((t) => t.id)).not.toContain("no-prices");
  });

  it("finds topics by every word typed, ignoring capitals", () => {
    expect(searchHelp("clock out", "owner").map((t) => t.id)).toContain("clock-out");
    expect(searchHelp("VENMO", "owner").map((t) => t.id)).toContain("get-paid");
    expect(searchHelp("venmo", "crew")).toEqual([]);
    expect(searchHelp("rain zzzz", "owner")).toEqual([]);
    expect(searchHelp("a", "owner")).toEqual([]);
    expect(searchHelp("   ", "owner")).toEqual([]);
  });

  it("groups topics by section, in order", () => {
    const sections = helpSections(helpFor("owner"));
    expect(sections[0].section).toBe("Today and the clock");
    expect(new Set(sections.map((s) => s.section)).size).toBe(sections.length);
    expect(sections.flatMap((s) => s.topics)).toHaveLength(helpFor("owner").length);
  });
});
