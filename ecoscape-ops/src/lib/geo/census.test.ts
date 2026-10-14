import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { censusGeocode, parseCensusMatches } from "./census";

// The shape the Census geocoder answers with (trimmed).
const RESPONSE = {
  result: {
    input: { address: { address: "61 Clarendon Rd, Lake Ronkonkoma, NY" }, benchmark: { benchmarkName: "Public_AR_Current" } },
    addressMatches: [
      {
        tigerLine: { side: "L", tigerLineId: "59653655" },
        coordinates: { x: -73.11021, y: 40.83547 },
        addressComponents: { zip: "11779", streetName: "CLARENDON", city: "LAKE RONKONKOMA", state: "NY", suffixType: "RD" },
        matchedAddress: "61 CLARENDON RD, LAKE RONKONKOMA, NY, 11779",
      },
    ],
  },
};

describe("parseCensusMatches", () => {
  it("reads each match, longitude from x and latitude from y", () => {
    expect(parseCensusMatches(RESPONSE)).toEqual([
      { lat: 40.83547, lon: -73.11021, matchedAddress: "61 CLARENDON RD, LAKE RONKONKOMA, NY, 11779", city: "LAKE RONKONKOMA", state: "NY", zip: "11779" },
    ]);
  });

  it("is empty for no match, and null for something else entirely", () => {
    expect(parseCensusMatches({ result: { addressMatches: [] } })).toEqual([]);
    expect(parseCensusMatches({ errors: ["Address cannot be empty"], status: "400" })).toBeNull();
    expect(parseCensusMatches("<html>")).toBeNull();
  });
});

describe("censusGeocode", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("asks for the one-line address on the current benchmark, identifying itself", async () => {
    const fetchMock = vi.fn(async () => Response.json(RESPONSE));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("CENSUS_GEOCODER_URL", "");
    const result = await censusGeocode("61 Clarendon Rd, Lake Ronkonkoma, NY");
    expect(result).toMatchObject({ ok: true, matches: [{ state: "NY" }] });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [URL, RequestInit];
    expect(url.origin).toBe("https://geocoding.geo.census.gov");
    expect(url.pathname).toBe("/geocoder/locations/onelineaddress");
    expect(Object.fromEntries(url.searchParams)).toEqual({ address: "61 Clarendon Rd, Lake Ronkonkoma, NY", benchmark: "Public_AR_Current", format: "json" });
    expect((init.headers as Record<string, string>)["User-Agent"]).toMatch(/^EcoScape Ops/);
  });

  it("reports the service being down as unavailable, not as 'no such address'", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal("fetch", vi.fn(async () => new Response("busy", { status: 503 })));
    expect(await censusGeocode("x")).toEqual({ ok: false });
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("fetch failed"); }));
    expect(await censusGeocode("x")).toEqual({ ok: false });
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ unexpected: true })));
    expect(await censusGeocode("x")).toEqual({ ok: false });
  });
});
