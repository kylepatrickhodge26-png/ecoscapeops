import { isUsState } from "./address";
import { milesBetween, type Point } from "./distance";

// What a geocoder found for an address.
export type GeoMatch = { lat: number; lon: number; matchedAddress: string; city: string; state: string; zip: string };

// Anything further than this from the shop is flagged rather than used.
export const MAX_MILES_FROM_SHOP = 50;

export type Assessment =
  | { status: "located"; match: GeoMatch; miles: number | null }
  | { status: "flagged"; match: GeoMatch; miles: number | null; reason: "outside_us" | "too_far" }
  | { status: "not_found" };

const validPoint = (m: GeoMatch) =>
  Number.isFinite(m.lat) && Number.isFinite(m.lon) && Math.abs(m.lat) <= 90 && Math.abs(m.lon) <= 180;

// Decides whether a lookup can be trusted. Only US matches count; with a shop to measure
// from, the closest one is used, and only if it's within MAX_MILES_FROM_SHOP. A match
// anywhere else (another state, another country) is flagged, never quietly accepted.
export function assessMatches(matches: GeoMatch[], shop: Point | null, maxMiles = MAX_MILES_FROM_SHOP): Assessment {
  const usable = matches.filter(validPoint);
  if (usable.length === 0) return { status: "not_found" };
  const miles = (m: GeoMatch) => (shop ? milesBetween(shop, m) : null);

  const inUs = usable.filter((m) => isUsState(m.state));
  if (inUs.length === 0) return { status: "flagged", match: usable[0], miles: miles(usable[0]), reason: "outside_us" };
  if (!shop) return { status: "located", match: inUs[0], miles: null };

  const closest = inUs.map((m) => ({ m, d: milesBetween(shop, m) })).sort((a, b) => a.d - b.d)[0];
  if (closest.d > maxMiles) return { status: "flagged", match: closest.m, miles: closest.d, reason: "too_far" };
  return { status: "located", match: closest.m, miles: closest.d };
}

// How a flagged or unfound address is explained to the owner.
export function geoProblem(status: string, matchedAddress: string | null, miles: number | null): string | null {
  if (status === "not_found") return "We couldn't find this address on the map. Check the street and town.";
  if (status !== "flagged") return null;
  const where = matchedAddress ? `“${matchedAddress}”` : "somewhere else";
  const far = miles !== null ? `, ${Math.round(miles).toLocaleString("en-US")} miles from your shop` : "";
  return `This address matched ${where}${far}, so it isn't used for routes. Check the street and town.`;
}
