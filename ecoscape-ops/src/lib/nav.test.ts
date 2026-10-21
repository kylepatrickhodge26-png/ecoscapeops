import { describe, expect, it } from "vitest";

import { activeSection, crewSections, isCurrent, ownerSections } from "./nav";

const owner = ownerSections({ newRequests: 2, hasCrew: true });

describe("menu sections", () => {
  it("has five short sections for owners, Today first", () => {
    expect(owner.map((s) => s.label)).toEqual(["Today", "Schedule", "Customers", "Money", "More"]);
  });
  it("keeps the right section highlighted on every page", () => {
    const cases: Record<string, string> = {
      "/dashboard": "home",
      "/customers/abc/edit": "customers",
      "/requests": "customers",
      "/schedule/jobs/1": "schedule",
      "/my-jobs": "schedule",
      "/weather/area": "schedule",
      "/quotes/new": "money",
      "/invoices/1": "money",
      "/expenses": "money",
      "/reports": "money",
      "/money": "money",
      "/crew": "more",
      "/time/1": "more",
      "/settings/checklists": "more",
      "/settings/faq": "more",
      "/help": "more",
    };
    for (const [path, key] of Object.entries(cases)) expect(activeSection(owner, path)?.key, path).toBe(key);
  });
  it("doesn't confuse similar paths", () => {
    expect(activeSection(owner, "/customers-export")).toBeUndefined();
    expect(isCurrent("/requests", "/request")).toBe(false);
  });
  it("shows My jobs only once there's a crew", () => {
    const solo = ownerSections({ newRequests: 0, hasCrew: false });
    expect(solo.find((s) => s.key === "schedule")!.links.map((l) => l.label)).toEqual(["Calendar", "Weather"]);
  });
  it("carries the new-request count to the Customers tab", () => {
    expect(owner.find((s) => s.key === "customers")!.badge).toBe(2);
  });
  it("gives crew only Today and My jobs, with no money pages", () => {
    const crew = crewSections();
    expect(crew.map((s) => s.label)).toEqual(["Today", "My jobs"]);
    expect(activeSection(crew, "/invoices")).toBeUndefined();
    expect(activeSection(crew, "/search")).toBeUndefined();
  });
});
