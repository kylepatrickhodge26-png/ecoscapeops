import { describe, expect, it } from "vitest";

import { safeNextPath } from "./redirect";

describe("safeNextPath", () => {
  it("allows paths on this site", () => {
    expect(safeNextPath("/customers")).toBe("/customers");
    expect(safeNextPath("/customers/abc/edit?x=1")).toBe("/customers/abc/edit?x=1");
  });

  it("rejects anything that could leave the site", () => {
    expect(safeNextPath("https://evil.example")).toBeNull();
    expect(safeNextPath("//evil.example")).toBeNull();
    expect(safeNextPath("/\\evil.example")).toBeNull();
    expect(safeNextPath("customers")).toBeNull();
    expect(safeNextPath(null)).toBeNull();
    expect(safeNextPath(undefined)).toBeNull();
  });
});
