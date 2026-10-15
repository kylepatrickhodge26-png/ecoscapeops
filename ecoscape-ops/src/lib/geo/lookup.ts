import "server-only";

import { customerQuery } from "./address";
import { censusGeocode } from "./census";
import type { Point } from "./distance";
import { assessMatches } from "./locate";

// Where the shop is, and the town and state that bare street addresses are anchored to.
export type Shop = Point & { city: string; state: string };

export type LookupResult =
  | { status: "located"; lat: number; lon: number; matchedAddress: string; miles: number | null; city: string; state: string; zip: string }
  | { status: "flagged"; matchedAddress: string; miles: number | null; reason: "outside_us" | "too_far" }
  | { status: "not_found" }
  // The geocoder couldn't be reached: try again later.
  | { status: "unavailable" };

// Looks up an address the way every customer address is looked up: anchored to the
// shop's town and state, US only, and flagged if it lands too far from `near` (the shop,
// unless given something else).
export async function lookUpAddress(address: string, anchor: Shop | null, near: Point | null = anchor): Promise<LookupResult> {
  const query = customerQuery(address, anchor);
  if (!query) return { status: "not_found" };
  const result = await censusGeocode(query);
  if (!result.ok) return { status: "unavailable" };
  const assessment = assessMatches(result.matches, near);
  if (assessment.status === "not_found") return assessment;
  const { match, miles } = assessment;
  if (assessment.status === "flagged") return { status: "flagged", matchedAddress: match.matchedAddress, miles, reason: assessment.reason };
  return { status: "located", lat: match.lat, lon: match.lon, matchedAddress: match.matchedAddress, miles, city: match.city, state: match.state, zip: match.zip };
}
