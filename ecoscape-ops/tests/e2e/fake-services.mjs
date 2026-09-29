// A stand-in for the National Weather Service's forecast API during end-to-end tests, so
// the tests never call the real service and always get the same forecast. Started by
// playwright.config.ts. Serves /points/{lat},{lon} and the forecast it links to, for the
// ZIP codes below (positions come from the same ZIP code list the app uses).
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

const server = createServer((req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  if (url.pathname === "/health") return json(res, 200, { ok: true });

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

server.listen(PORT, "127.0.0.1", () => console.log(`Fake National Weather Service listening on ${PORT}`));
