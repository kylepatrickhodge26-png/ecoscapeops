import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { lookupZip } from "./zip";

describe("lookupZip", () => {
  it("finds a US ZIP code's town and map position", () => {
    expect(lookupZip("11779")).toEqual({
      postalCode: "11779",
      placeName: "Ronkonkoma, NY",
      latitude: expect.closeTo(40.81, 1),
      longitude: expect.closeTo(-73.13, 1),
    });
    expect(lookupZip("90210")?.placeName).toBe("Beverly Hills, CA");
    expect(lookupZip("00601")?.placeName).toBe("Adjuntas, PR");
  });

  it.each(["00000", "1177", "117790", "K1A0B1", "", "11779 "])("finds nothing for %j", (zip) => {
    expect(lookupZip(zip)).toBeNull();
  });
});
