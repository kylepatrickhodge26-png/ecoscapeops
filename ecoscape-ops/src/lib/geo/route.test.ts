import { describe, expect, it } from "vitest";

import { moveStop, routeOrder, suggestedOrder, type Stop } from "./route";

// Stops along a line east of the shop (longitude), plus one with no location.
const SHOP = { lat: 40, lon: -73 };
const at = (id: string, lon: number | null): Stop<string> => ({ id, point: lon === null ? null : { lat: 40, lon }, item: id });
const ids = (stops: Stop<string>[]) => stops.map((s) => s.id);

describe("suggestedOrder", () => {
  it("goes to the nearest stop first, then the nearest to that", () => {
    // From the shop: B (0.1 east) first; then from B, D (0.25) beats C (0.4)… and A is west.
    const stops = [at("A", -73.3), at("C", -72.6), at("B", -72.9), at("D", -72.75)];
    expect(ids(suggestedOrder(SHOP, stops))).toEqual(["B", "D", "C", "A"]);
  });

  it("is nearest-neighbor, not just distance from the shop", () => {
    // A is closest to the shop, but after A, C (next to A) comes before B.
    const stops = [at("B", -72.8), at("C", -73.25), at("A", -73.15)];
    expect(ids(suggestedOrder(SHOP, stops))).toEqual(["A", "C", "B"]);
  });

  it("puts stops it can't place last, in the order given", () => {
    expect(ids(suggestedOrder(SHOP, [at("X", null), at("A", -72.9), at("Y", null)]))).toEqual(["A", "X", "Y"]);
  });

  it("starts from wherever it's told to", () => {
    const stops = [at("West", -73.5), at("East", -72.5)];
    expect(ids(suggestedOrder({ lat: 40, lon: -72.4 }, stops))).toEqual(["East", "West"]);
    expect(ids(suggestedOrder({ lat: 40, lon: -73.6 }, stops))).toEqual(["West", "East"]);
  });

  it("keeps the given order with nowhere to start from", () => {
    expect(ids(suggestedOrder(null, [at("B", -72.8), at("A", -72.9), at("X", null)]))).toEqual(["B", "A", "X"]);
  });
});

describe("routeOrder", () => {
  const stops = [at("A", -72.9), at("B", -72.8), at("C", -72.7)];

  it("uses the suggested order until someone sets one", () => {
    expect(ids(routeOrder(SHOP, stops, null))).toEqual(["A", "B", "C"]);
  });

  it("keeps the order set with the arrows", () => {
    expect(ids(routeOrder(SHOP, stops, ["C", "A", "B"]))).toEqual(["C", "A", "B"]);
  });

  it("puts visits added since then at the end, and forgets ones no longer on the route", () => {
    const later = [...stops, at("D", -72.95), at("E", null)];
    // After B (-72.8), A (-72.9) is nearer than D (-72.95).
    expect(ids(routeOrder(SHOP, later, ["C", "gone", "B"]))).toEqual(["C", "B", "A", "D", "E"]);
  });
});

describe("moveStop", () => {
  it("swaps a stop with its neighbor, and does nothing past either end", () => {
    expect(moveStop(["A", "B", "C"], "B", "up")).toEqual(["B", "A", "C"]);
    expect(moveStop(["A", "B", "C"], "B", "down")).toEqual(["A", "C", "B"]);
    expect(moveStop(["A", "B", "C"], "A", "up")).toEqual(["A", "B", "C"]);
    expect(moveStop(["A", "B", "C"], "C", "down")).toEqual(["A", "B", "C"]);
    expect(moveStop(["A", "B", "C"], "Z", "up")).toEqual(["A", "B", "C"]);
  });
});
