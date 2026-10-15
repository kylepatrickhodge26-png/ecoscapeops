import "server-only";

import { z } from "zod";

import type { GeoMatch } from "./locate";

// The U.S. Census Bureau's geocoder: free, no account or key, US addresses only.
// https://geocoding.geo.census.gov/geocoder/

const USER_AGENT = "EcoScape Ops (github.com/kylepatrickhodge26-png/ecoscapeops)";

// CENSUS_GEOCODER_URL is only for tests.
const baseUrl = () => process.env.CENSUS_GEOCODER_URL || "https://geocoding.geo.census.gov";

const responseSchema = z.object({
  result: z.object({
    addressMatches: z.array(
      z.object({
        matchedAddress: z.string(),
        coordinates: z.object({ x: z.number(), y: z.number() }),
        addressComponents: z
          .object({ city: z.string().optional(), state: z.string().optional(), zip: z.string().optional() })
          .partial()
          .optional(),
      }),
    ),
  }),
});

// Every match in a geocoder response (x is longitude, y latitude), or null if the response
// isn't one.
export function parseCensusMatches(body: unknown): GeoMatch[] | null {
  const parsed = responseSchema.safeParse(body);
  if (!parsed.success) return null;
  return parsed.data.result.addressMatches.map((m) => ({
    lat: m.coordinates.y,
    lon: m.coordinates.x,
    matchedAddress: m.matchedAddress,
    city: m.addressComponents?.city ?? "",
    state: m.addressComponents?.state ?? "",
    zip: m.addressComponents?.zip ?? "",
  }));
}

export type CensusResult = { ok: true; matches: GeoMatch[] } | { ok: false };

// Looks up a one-line address. { ok: false } means the service couldn't be reached or
// answered oddly (try again later), not that the address doesn't exist.
export async function censusGeocode(query: string): Promise<CensusResult> {
  const url = new URL("/geocoder/locations/onelineaddress", baseUrl());
  url.search = new URLSearchParams({ address: query, benchmark: "Public_AR_Current", format: "json" }).toString();
  try {
    const response = await fetch(url, {
      headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) {
      console.error(`Census geocoder failed: HTTP ${response.status}`);
      return { ok: false };
    }
    const matches = parseCensusMatches(await response.json());
    if (!matches) {
      console.error("Census geocoder answered with an unexpected shape");
      return { ok: false };
    }
    return { ok: true, matches };
  } catch (error) {
    console.error("Census geocoder failed", error instanceof Error ? error.message : error);
    return { ok: false };
  }
}
