import "server-only";

import zipcodes from "zipcodes";

export type Place = { postalCode: string; placeName: string; latitude: number; longitude: number };

// A US ZIP code's town and map position, from a ZIP code list bundled with the app (the
// zipcodes package), so setting a service area needs no outside service.
export function lookupZip(zip: string): Place | null {
  if (!/^\d{5}$/.test(zip)) return null;
  const found = zipcodes.lookup(zip);
  if (!found || found.country !== "US") return null;
  return {
    postalCode: zip,
    placeName: `${found.city}, ${found.state}`.slice(0, 100),
    latitude: found.latitude,
    longitude: found.longitude,
  };
}
