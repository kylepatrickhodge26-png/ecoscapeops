import { describe, expect, it } from "vitest";

import { checklistSchema, parseChecklistLines } from "./checklist";

describe("checklist text", () => {
  it("takes one item per line and drops blanks and bullets", () => {
    expect(parseChecklistLines("Mow\n\n - Edge \n2. Blow\r\n• Bag clippings\n")).toEqual(["Mow", "Edge", "Blow", "Bag clippings"]);
  });
  it("validates the service name and limits", () => {
    expect(checklistSchema.safeParse({ service_name: "Mowing", items: ["Mow"] }).success).toBe(true);
    expect(checklistSchema.safeParse({ service_name: " ", items: ["Mow"] }).success).toBe(false);
    expect(checklistSchema.safeParse({ service_name: "Mowing", items: Array(31).fill("x") }).success).toBe(false);
    expect(checklistSchema.safeParse({ service_name: "Mowing", items: ["x".repeat(121)] }).success).toBe(false);
  });
  it("allows no items, which removes the checklist", () => {
    expect(checklistSchema.safeParse({ service_name: "Mowing", items: [] }).success).toBe(true);
  });
});
