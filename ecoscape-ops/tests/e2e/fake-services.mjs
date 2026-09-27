// Stand-ins for OpenWeather and Twilio during end-to-end tests, so the tests never call
// the real services, cost nothing, and can check exactly what would have been sent.
// Started by playwright.config.ts with the same fake credentials the app gets.
//
//   OpenWeather: /geo/1.0/zip and /data/3.0/onecall for the ZIP codes below.
//   Twilio:      POST /2010-04-01/Accounts/{sid}/Messages.json records the text, then
//                sends signed status callbacks (sent → delivered) like Twilio does.
//                GET /__twilio/messages lists every text received.
import { createHmac, randomBytes } from "node:crypto";
import { createServer } from "node:http";

const PORT = Number(process.env.FAKE_SERVICES_PORT);
const OPENWEATHER_KEY = process.env.OPENWEATHER_API_KEY;
const TWILIO_SID = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const TIME_ZONE = "America/New_York";

// Keep in step with FAKE_PLACES in tests/e2e/fakes.ts.
const PLACES = {
  11779: { name: "Lake Ronkonkoma", lat: 40.8154, lon: -73.1123, pops: [0.1, 0.8, 0.3, 0.2, 0, 0.1, 0.05, 0.4] },
  10001: { name: "New York", lat: 40.7484, lon: -73.9967, pops: [0.05, 0.2, 0.65, 0.9, 0.1, 0, 0, 0] },
  90210: { name: "Beverly Hills", lat: 34.0901, lon: -118.4065, pops: [0, 0, 0, 0, 0, 0, 0, 0] },
  // Geocodes fine, but its forecast is always an error.
  59001: { name: "Outage Falls", lat: 45.5, lon: -109.5, pops: null },
};

// Twilio test numbers with special behaviour. Keep in step with tests/e2e/fakes.ts.
const UNSUBSCRIBED = "+12025550666"; // refused: replied STOP (21610)
const UNDELIVERABLE = "+12025550777"; // accepted, then undelivered (30007)

const messages = [];

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

function twilioSignature(url, params) {
  const data = Object.keys(params)
    .sort()
    .reduce((acc, key) => acc + key + params[key], url);
  return createHmac("sha1", TWILIO_TOKEN).update(Buffer.from(data, "utf-8")).digest("base64");
}

async function statusCallback(message, status, errorCode) {
  if (!message.statusCallback) return;
  const params = {
    AccountSid: TWILIO_SID,
    ApiVersion: "2010-04-01",
    From: message.from,
    MessageSid: message.sid,
    MessageStatus: status,
    SmsSid: message.sid,
    SmsStatus: status,
    To: message.to,
    ...(errorCode ? { ErrorCode: String(errorCode) } : {}),
  };
  try {
    const response = await fetch(message.statusCallback, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "X-Twilio-Signature": twilioSignature(message.statusCallback, params),
      },
      body: new URLSearchParams(params),
    });
    message.callbacks.push({ status, httpStatus: response.status });
  } catch (error) {
    message.callbacks.push({ status, error: String(error) });
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function json(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf-8");
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);

  if (url.pathname === "/health") return json(res, 200, { ok: true });

  // ---- OpenWeather ----
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

  // ---- Twilio ----
  if (url.pathname === "/__twilio/messages") return json(res, 200, messages);

  const send = /^\/2010-04-01\/Accounts\/([^/]+)\/Messages\.json$/.exec(url.pathname);
  if (send && req.method === "POST") {
    const expectedAuth = `Basic ${Buffer.from(`${TWILIO_SID}:${TWILIO_TOKEN}`).toString("base64")}`;
    if (send[1] !== TWILIO_SID || req.headers.authorization !== expectedAuth) {
      return json(res, 401, { code: 20003, message: "Authenticate", status: 401 });
    }
    const form = Object.fromEntries(new URLSearchParams(await readBody(req)));
    if (!form.To || !form.From || !form.Body) return json(res, 400, { code: 21604, message: "Missing parameter", status: 400 });
    if (form.To === UNSUBSCRIBED) {
      return json(res, 400, { code: 21610, message: "Attempt to send to unsubscribed recipient", status: 400 });
    }

    const message = {
      sid: `SM${randomBytes(16).toString("hex")}`,
      to: form.To,
      from: form.From,
      body: form.Body,
      statusCallback: form.StatusCallback ?? null,
      callbacks: [],
    };
    messages.push(message);
    json(res, 201, { sid: message.sid, status: "queued", to: message.to, from: message.from, body: message.body });

    // Twilio reports progress a moment later.
    await sleep(500);
    await statusCallback(message, "sent");
    await sleep(500);
    if (message.to === UNDELIVERABLE) await statusCallback(message, "undelivered", 30007);
    else await statusCallback(message, "delivered");
    return;
  }

  json(res, 404, { message: "Not found" });
});

server.listen(PORT, "127.0.0.1", () => console.log(`Fake OpenWeather/Twilio listening on ${PORT}`));
