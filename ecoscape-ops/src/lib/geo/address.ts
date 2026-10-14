// Turning an address as someone typed it into what we ask the geocoder for.
//
// A bare street ("12 Oak St") exists in hundreds of places, so it's always anchored to the
// shop's city and state. An address that already names its own town or ZIP keeps it (a
// customer in the next town over is still found), and gets the shop's state if it has
// none. The geocoder (U.S. Census) only knows US addresses, so the country is always the
// US; anything it returns is still checked against the shop's location (see locate.ts).

export const US_STATES: Record<string, string> = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California", CO: "Colorado",
  CT: "Connecticut", DE: "Delaware", DC: "District of Columbia", FL: "Florida", GA: "Georgia",
  HI: "Hawaii", ID: "Idaho", IL: "Illinois", IN: "Indiana", IA: "Iowa", KS: "Kansas",
  KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland", MA: "Massachusetts",
  MI: "Michigan", MN: "Minnesota", MS: "Mississippi", MO: "Missouri", MT: "Montana",
  NE: "Nebraska", NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey", NM: "New Mexico",
  NY: "New York", NC: "North Carolina", ND: "North Dakota", OH: "Ohio", OK: "Oklahoma",
  OR: "Oregon", PA: "Pennsylvania", RI: "Rhode Island", SC: "South Carolina", SD: "South Dakota",
  TN: "Tennessee", TX: "Texas", UT: "Utah", VT: "Vermont", VA: "Virginia", WA: "Washington",
  WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming", PR: "Puerto Rico",
};

export const isUsState = (code: string | null | undefined) => Boolean(code && Object.hasOwn(US_STATES, code.toUpperCase()));

// The town and state a bare street is anchored to: the shop's.
export type Anchor = { city: string; state: string };

const ZIP_AT_END = /[\s,]+(\d{5}(?:-\d{4})?)$/;
const STATE_NAMES = Object.values(US_STATES).map((n) => n.toLowerCase());
// "Apt 4", "Unit B", "#2"… after a comma is part of the street, not a town.
const UNIT = /^(apt|apartment|unit|suite|ste|lot|bldg|building|fl|floor|rm|room|#)\b|^#/i;

// Collapses lines, spaces and commas, and drops a trailing country (it's always the US).
export function tidyAddress(address: string): string {
  return address
    .replace(/[\r\n]+/g, ",")
    .replace(/\s+/g, " ")
    .replace(/\s*,[\s,]*/g, ", ")
    .replace(/^[\s,]+|[\s,]+$/g, "")
    .replace(/(?:,\s*|\s)(?:USA|U\.S\.A\.?|US|U\.S\.?|United States(?: of America)?)$/i, "")
    .replace(/[\s,]+$/, "");
}

function splitZip(address: string): { rest: string; zip: string | null } {
  const match = ZIP_AT_END.exec(address);
  return match ? { rest: address.slice(0, match.index).trim(), zip: match[1] } : { rest: address, zip: null };
}

// Whether the address already ends in a US state ("…, NY", "…, Lake Grove NY 11755",
// "…, New York"). A two-letter code on its own after a street could be a direction (NE,
// "12 Oak St NE"), so it only counts after a comma or before a ZIP.
export function hasState(address: string): boolean {
  const { rest, zip } = splitZip(address);
  const parts = rest.split(",").map((p) => p.trim()).filter(Boolean);
  const last = parts.at(-1) ?? "";
  if (parts.length > 1 && (isUsState(last) || STATE_NAMES.includes(last.toLowerCase()))) return true;
  const words = last.split(" ");
  const code = words.at(-1) ?? "";
  return words.length > 1 && /^[A-Z]{2}$/.test(code) && isUsState(code) && (parts.length > 1 || zip !== null);
}

// Whether the address names its own town: something after a comma that isn't a unit.
export function hasTown(address: string): boolean {
  const { rest } = splitZip(address);
  return rest
    .split(",")
    .slice(1)
    .some((part) => part.trim() !== "" && !UNIT.test(part.trim()));
}

// The one-line address to look up for a customer (or a one-day start), or null if blank.
export function customerQuery(address: string, anchor: Anchor | null): string | null {
  const tidy = tidyAddress(address);
  if (!tidy) return null;
  if (!anchor || hasState(tidy)) return tidy;
  const { rest, zip } = splitZip(tidy);
  if (hasTown(tidy) || zip) return `${rest}, ${anchor.state}${zip ? ` ${zip}` : ""}`;
  return `${tidy}, ${anchor.city}, ${anchor.state}`;
}

// The shop has nothing to be anchored to, so it has to say where it is itself.
export function shopAddressProblem(address: string): string | null {
  const tidy = tidyAddress(address);
  if (!tidy) return "Enter the shop's address";
  if (!hasState(tidy) && !splitZip(tidy).zip) return "Include the town and state, like 61 Clarendon Rd, Lake Ronkonkoma, NY";
  return null;
}
