import { describe, expect, it } from "vitest";

import { milesBetween } from "./distance";
import { assessMatches, geoProblem, type GeoMatch } from "./locate";

const SHOP = { lat: 40.835, lon: -73.11 }; // Lake Ronkonkoma, NY
const match = (lat: number, lon: number, state: string, matchedAddress = "12 OAK ST"): GeoMatch => ({ lat, lon, state, matchedAddress, city: "", zip: "" });

describe("milesBetween", () => {
  it("measures straight-line miles", () => {
    expect(milesBetween(SHOP, SHOP)).toBe(0);
    // Lake Ronkonkoma to Manhattan is about 47 miles; to London about 3,460.
    expect(milesBetween(SHOP, { lat: 40.7484, lon: -73.9857 })).toBeCloseTo(46.4, 0);
    expect(milesBetween(SHOP, { lat: 51.5034, lon: -0.1276 })).toBeGreaterThan(3400);
  });
});

describe("assessMatches", () => {
  it("accepts a US match near the shop", () => {
    const result = assessMatches([match(40.85, -73.1, "NY")], SHOP);
    expect(result).toMatchObject({ status: "located", match: { state: "NY" } });
    expect(result.status === "located" && result.miles).toBeLessThan(2);
  });

  it("flags a match in another country, wherever it is", () => {
    const london = match(51.5034, -0.1276, "", "10 Downing St, London SW1A 2AA, United Kingdom");
    expect(assessMatches([london], SHOP)).toMatchObject({ status: "flagged", reason: "outside_us", match: { matchedAddress: london.matchedAddress } });
    // Even a non-US match that happens to be close isn't trusted.
    expect(assessMatches([match(40.84, -73.1, "ON")], SHOP)).toMatchObject({ status: "flagged", reason: "outside_us" });
    // And without a shop to measure from.
    expect(assessMatches([london], null)).toMatchObject({ status: "flagged", reason: "outside_us", miles: null });
  });

  it("flags a US match too far from the shop", () => {
    const texas = match(32.7767, -96.797, "TX", "12 CLARENDON RD, DALLAS, TX");
    const result = assessMatches([texas], SHOP);
    expect(result).toMatchObject({ status: "flagged", reason: "too_far", match: { state: "TX" } });
    expect(result.status === "flagged" && result.miles).toBeGreaterThan(1300);
    // 50 miles is the limit.
    expect(assessMatches([match(40.835, -72.15, "NY")], SHOP).status).toBe("flagged");
    expect(assessMatches([match(40.835, -72.3, "NY")], SHOP).status).toBe("located");
  });

  it("picks the closest US match when there are several", () => {
    const result = assessMatches([match(32.7767, -96.797, "TX"), match(51.5, -0.12, ""), match(40.8, -73.2, "NY", "NEAR")], SHOP);
    expect(result).toMatchObject({ status: "located", match: { matchedAddress: "NEAR" } });
  });

  it("is not found with no usable matches", () => {
    expect(assessMatches([], SHOP)).toEqual({ status: "not_found" });
    expect(assessMatches([match(Number.NaN, 0, "NY"), match(95, 0, "NY")], SHOP)).toEqual({ status: "not_found" });
  });

  it("without a shop (the shop's own address), takes the first US match", () => {
    expect(assessMatches([match(51.5, -0.12, ""), match(40.8, -73.1, "NY", "US ONE")], null)).toMatchObject({ status: "located", match: { matchedAddress: "US ONE" }, miles: null });
  });
});

describe("geoProblem", () => {
  it("explains what went wrong", () => {
    expect(geoProblem("located", "x", 1)).toBeNull();
    expect(geoProblem("pending", null, null)).toBeNull();
    expect(geoProblem("not_found", null, null)).toContain("couldn't find this address");
    expect(geoProblem("flagged", "10 Downing St, London", 3460.4)).toBe(
      "This address matched “10 Downing St, London”, 3,460 miles from your shop, so it isn't used for routes. Check the street and town.",
    );
  });
});
