// A stand-in for OpenWeather during end-to-end tests, so the tests never call the real
// service and always get the same forecast. Started by playwright.config.ts with the same
// fake API key the app gets. Serves /geo/1.0/zip and /data/3.0/onecall for the ZIP
// codes below.
import { createServer } from "node:http";

const PORT = Number(process.env.FAKE_SERVICES_PORT);
const OPENWEATHER_KEY = process.env.OPENWEATHER_API_KEY;
const TIME_ZONE = "America/New_York";

// Keep in step with FAKE_PLACES in tests/e2e/fakes.ts.
const PLACES = {
  11779: { name: "Lake Ronkonkoma", lat: 40.8154, lon: -73.1123, pops: [0.1, 0.8, 0.3, 0.2, 0, 0.1, 0.05, 0.4] },
  10001: { name: "New York", lat: 40.7484, lon: -73.9967, pops: [0.05, 0.2, 0.65, 0.9, 0.1, 0, 0, 0] },
  90210: { name: "Beverly Hills", lat: 34.0901, lon: -118.4065, pops: [0, 0, 0, 0, 0, 0, 0, 0] },
  // Geocodes fine, but its forecast is always an error.
  59001: { name: "Outage Falls", lat: 45.5, lon: -109.5, pops: null },
};

function todayIn(timeZone) {
  return new Intl.DateTimeFormat("en-CA", { timeZone }).format(new Date());
}

// e.g. -14400 for "GMT-04:00"
function utcOffsetSeconds(timeZone) {
  const name = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "longOffset" })
    .formatToParts(new Date())
    .find((p) => p.type === "timeZoneName").value;
  const match = /GMT([+-])(\d{2}):(\d{2})/.exec(name);
  return match ? (match[1] === "-" ? -1 : 1) * (Number(match[2]) * 3600 + Number(match[3]) * 60) : 0;
}

function forecastFor(place) {
  const offset = utcOffsetSeconds(TIME_ZONE);
  const [y, m, d] = todayIn(TIME_ZONE).split("-").map(Number);
  return {
    lat: place.lat,
    lon: place.lon,
    timezone: TIME_ZONE,
    timezone_offset: offset,
    daily: place.pops.map((pop, i) => ({
      dt: Date.UTC(y, m - 1, d + i, 12) / 1000 - offset,
      pop,
      summary: pop >= 0.5 ? "Rain likely through the afternoon" : "Partly cloudy",
      temp: { min: 55 + i, max: 70 + i },
      weather: [{ id: pop >= 0.5 ? 501 : 802, main: pop >= 0.5 ? "Rain" : "Clouds", description: "test" }],
    })),
  };
}

function json(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);

  if (url.pathname === "/health") return json(res, 200, { ok: true });

  if (url.pathname === "/geo/1.0/zip" || url.pathname === "/data/3.0/onecall") {
    if (url.searchParams.get("appid") !== OPENWEATHER_KEY) return json(res, 401, { cod: 401, message: "Invalid API key" });
    if (url.pathname === "/geo/1.0/zip") {
      const [zip, country] = (url.searchParams.get("zip") ?? "").split(",");
      const place = country === "US" && PLACES[zip];
      if (!place) return json(res, 404, { cod: "404", message: "not found" });
      return json(res, 200, { zip, name: place.name, lat: place.lat, lon: place.lon, country: "US" });
    }
    const key = `${url.searchParams.get("lat")},${url.searchParams.get("lon")}`;
    const place = Object.values(PLACES).find((p) => `${p.lat.toFixed(2)},${p.lon.toFixed(2)}` === key);
    if (!place) return json(res, 400, { cod: "400", message: "unknown location" });
    if (!place.pops) return json(res, 500, { cod: "500", message: "Internal error" });
    return json(res, 200, forecastFor(place));
  }

  json(res, 404, { message: "Not found" });
});

server.listen(PORT, "127.0.0.1", () => console.log(`Fake OpenWeather listening on ${PORT}`));
