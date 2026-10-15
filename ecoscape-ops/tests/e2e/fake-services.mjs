// Stand-ins for the National Weather Service's forecast API and the U.S. Census geocoder
// during end-to-end tests, so the tests never call the real services and always get the
// same answers. Started by playwright.config.ts.
//
//   Weather:  /points/{lat},{lon} and the forecast it links to, for the ZIP codes below
//             (positions come from the same ZIP code list the app uses).
//   Geocoder: /geocoder/locations/onelineaddress for the addresses in ADDRESSES, answering
//             in the Census geocoder's format. /__census/queries lists what was asked.
import { createServer } from "node:http";

import zipcodes from "zipcodes";

const PORT = Number(process.env.FAKE_SERVICES_PORT);
const TIME_ZONE = "America/New_York";

// Chance of rain (%) for today and the next six days. Keep in step with FAKE_PLACES in
// tests/e2e/fakes.ts.
const PLACES = {
  11779: [10, 80, 30, 20, 0, 10, 40],
  10001: [5, 20, 65, 90, 10, 0, 0],
  90210: [0, 0, 0, 0, 0, 0, 0],
  // A real place, but its forecast is always an error.
  59001: null,
};

const position = (zip) => {
  const { latitude, longitude } = zipcodes.lookup(zip);
  return `${latitude.toFixed(4)},${longitude.toFixed(4)}`;
};

function todayIn(timeZone) {
  return new Intl.DateTimeFormat("en-CA", { timeZone }).format(new Date());
}

// e.g. "-04:00"
function utcOffset(timeZone) {
  const name = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "longOffset" })
    .formatToParts(new Date())
    .find((p) => p.type === "timeZoneName").value;
  return /GMT([+-]\d{2}:\d{2})/.exec(name)?.[1] ?? "+00:00";
}

function addDays(isoDate, days) {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// Day and night periods, like the real forecast. Nights are a little drier than days.
function forecastFor(rain) {
  const today = todayIn(TIME_ZONE);
  const offset = utcOffset(TIME_ZONE);
  const periods = rain.flatMap((pop, i) => {
    const date = addDays(today, i);
    const summary = pop >= 50 ? "Showers And Thunderstorms" : "Partly Cloudy";
    return [
      { name: `Day ${i}`, startTime: `${date}T06:00:00${offset}`, isDaytime: true, temperature: 70 + i, pop, summary },
      { name: `Night ${i}`, startTime: `${date}T18:00:00${offset}`, isDaytime: false, temperature: 55 + i, pop: Math.floor(pop / 2), summary },
    ];
  });
  return {
    type: "Feature",
    properties: {
      units: "us",
      periods: periods.map((p, i) => ({
        number: i + 1,
        name: p.name,
        startTime: p.startTime,
        endTime: p.startTime,
        isDaytime: p.isDaytime,
        temperature: p.temperature,
        temperatureUnit: "F",
        probabilityOfPrecipitation: { unitCode: "wmoUnit:percent", value: p.pop },
        windSpeed: "5 mph",
        windDirection: "SW",
        shortForecast: p.summary,
        detailedForecast: "",
      })),
    },
  };
}

function json(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/geo+json" });
  res.end(JSON.stringify(body));
}

// ---------------------------------------------------------------------------
// Census geocoder
// ---------------------------------------------------------------------------
// What each one-line query finds. Keep in step with ADDRESSES in tests/e2e/fakes.ts. The
// shop is at 40.835, -73.11; the stops sit along the same latitude, east and west of it.
const at = (lon, matchedAddress, state = "NY", lat = 40.835) => ({ lat, lon, matchedAddress, state });
const ADDRESSES = {
  "61 clarendon rd, lake ronkonkoma, ny": at(-73.11, "61 CLARENDON RD, LAKE RONKONKOMA, NY, 11779"),
  "1 near st, lake ronkonkoma, ny": at(-73.1, "1 NEAR ST, LAKE RONKONKOMA, NY, 11779"),
  "2 middle st, lake ronkonkoma, ny": at(-73.07, "2 MIDDLE ST, LAKE RONKONKOMA, NY, 11779"),
  "3 far st, lake ronkonkoma, ny": at(-73.02, "3 FAR ST, LAKE RONKONKOMA, NY, 11779"),
  "4 west st, lake ronkonkoma, ny": at(-73.18, "4 WEST ST, LAKE RONKONKOMA, NY, 11779"),
  // A customer in the next town over, who names their own town.
  "5 lake ave, lake grove, ny": at(-73.115, "5 LAKE AVE, LAKE GROVE, NY, 11755", "NY", 40.86),
  // A one-day start, west of everything.
  "8 home rd, lake ronkonkoma, ny": at(-73.2, "8 HOME RD, LAKE RONKONKOMA, NY, 11779"),
  // A geocoder that goes wrong and matches a bare street in another country: the app
  // must catch it.
  "10 downing st, lake ronkonkoma, ny": at(-0.1276, "10 Downing St, London SW1A 2AA, United Kingdom", "", 51.5034),
  // A real US match, but in another state, far from the shop.
  "12 clarendon rd, dallas, tx": at(-96.797, "12 CLARENDON RD, DALLAS, TX, 75201", "TX", 32.7767),
};
// Addresses the "service" is down for.
const OUTAGES = new Set(["500 outage rd, lake ronkonkoma, ny"]);
const geocodeQueries = [];

function handleCensus(url, res) {
  if (url.pathname === "/__census/queries") return json(res, 200, geocodeQueries);
  if (url.pathname !== "/geocoder/locations/onelineaddress") return json(res, 404, { errors: ["Not found"] });
  const address = url.searchParams.get("address") ?? "";
  if (url.searchParams.get("benchmark") !== "Public_AR_Current" || url.searchParams.get("format") !== "json") {
    return json(res, 400, { errors: ["Benchmark and format are required"], status: "400" });
  }
  geocodeQueries.push(address);
  const key = address.toLowerCase().replace(/\s+/g, " ").trim();
  if (OUTAGES.has(key)) return json(res, 503, { errors: ["Service unavailable"] });
  const found = ADDRESSES[key];
  return json(res, 200, {
    result: {
      input: { address: { address }, benchmark: { benchmarkName: "Public_AR_Current" } },
      addressMatches: found
        ? [
            {
              tigerLine: { side: "L", tigerLineId: "1" },
              coordinates: { x: found.lon, y: found.lat },
              addressComponents: { city: found.matchedAddress.split(", ")[1], state: found.state, zip: found.matchedAddress.split(", ")[3] ?? "" },
              matchedAddress: found.matchedAddress,
            },
          ]
        : [],
    },
  });
}

const server = createServer((req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  if (url.pathname === "/health") return json(res, 200, { ok: true });
  if (url.pathname.startsWith("/geocoder/") || url.pathname.startsWith("/__census/")) return handleCensus(url, res);

  // The real service refuses requests that don't say who's asking.
  if (!req.headers["user-agent"]?.startsWith("EcoScape Ops")) {
    return json(res, 403, { title: "Forbidden", detail: "A User-Agent is required", status: 403 });
  }

  const points = /^\/points\/([-\d.]+,[-\d.]+)$/.exec(url.pathname);
  if (points) {
    const zip = Object.keys(PLACES).find((z) => position(z) === points[1]);
    if (!zip) return json(res, 404, { title: "Data Unavailable For Requested Point", status: 404 });
    return json(res, 200, {
      properties: { forecast: `http://127.0.0.1:${PORT}/gridpoints/TST/${zip}/forecast`, timeZone: TIME_ZONE },
    });
  }

  const forecast = /^\/gridpoints\/TST\/(\d{5})\/forecast$/.exec(url.pathname);
  if (forecast && forecast[1] in PLACES) {
    const rain = PLACES[forecast[1]];
    if (!rain) return json(res, 500, { title: "Unexpected Problem", status: 500 });
    return json(res, 200, forecastFor(rain));
  }

  json(res, 404, { title: "Not Found", status: 404 });
});

server.listen(PORT, "127.0.0.1", () => console.log(`Fake National Weather Service and Census geocoder listening on ${PORT}`));
