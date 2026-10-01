// Stand-ins for the National Weather Service and Stripe during end-to-end tests, so the
// tests never call the real services and can check exactly what happened. Started by
// playwright.config.ts.
//
//   Weather: /points/{lat},{lon} and the forecast it links to, for the ZIP codes below
//            (positions come from the same ZIP code list the app uses).
//   Stripe:  the API calls the app makes (accounts, account links, Checkout sessions),
//            plus pages standing in for Stripe's hosted onboarding and Checkout, which send
//            the app signed webhooks just like Stripe does. /__stripe/* lets tests look
//            at and resend events.
import { randomBytes } from "node:crypto";
import { createServer } from "node:http";

import Stripe from "stripe";
import zipcodes from "zipcodes";

const PORT = Number(process.env.FAKE_SERVICES_PORT);
const BASE = `http://127.0.0.1:${PORT}`;
const TIME_ZONE = "America/New_York";
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;
const APP_WEBHOOK_URL = process.env.APP_WEBHOOK_URL;

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
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

// ---------------------------------------------------------------------------
// Stripe
// ---------------------------------------------------------------------------
const signer = new Stripe("sk_test_signer");
const accounts = new Map(); // id → account
const accountsByIdempotencyKey = new Map();
const sessions = new Map(); // id → { session, account }
const events = []; // every event sent, with the app's response

const newId = (prefix) => `${prefix}_${randomBytes(12).toString("hex")}`;

// Stripe's form encoding: line_items[0][price_data][unit_amount]=6500 → nested objects/arrays.
function parseStripeForm(body) {
  const root = {};
  for (const [key, value] of new URLSearchParams(body)) {
    const parts = key.split(/\[|\]\[|\]/).filter((p) => p !== "");
    let node = root;
    parts.forEach((part, i) => {
      const last = i === parts.length - 1;
      if (last) node[part] = value;
      else node = node[part] ??= /^\d+$/.test(parts[i + 1]) ? [] : {};
    });
  }
  return root;
}

function stripeError(res, status, message, param) {
  return json(res, status, { error: { type: "invalid_request_error", message, ...(param ? { param } : {}) } });
}

async function sendEvent(type, object, account, eventId = newId("evt")) {
  const event = { id: eventId, object: "event", api_version: "2026-08-26.dahlia", created: Math.floor(Date.now() / 1000), livemode: false, type, account, data: { object } };
  const payload = JSON.stringify(event);
  const signature = signer.webhooks.generateTestHeaderString({ payload, secret: STRIPE_WEBHOOK_SECRET });
  let status;
  try {
    const response = await fetch(APP_WEBHOOK_URL, { method: "POST", headers: { "Content-Type": "application/json", "Stripe-Signature": signature }, body: payload });
    status = response.status;
  } catch (error) {
    status = String(error);
  }
  events.push({ event, status });
  return status;
}

const html = (res, body) => {
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Fake Stripe</title></head><body>${body}</body></html>`);
};
const redirect = (res, location) => {
  res.writeHead(303, { Location: location });
  res.end();
};

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf-8");
}

async function handleStripe(req, res, url) {
  // --- The API the app calls with its secret key ---
  if (url.pathname.startsWith("/v1/")) {
    if (req.headers.authorization !== `Bearer ${STRIPE_SECRET_KEY}`) return stripeError(res, 401, "Invalid API Key provided");
    const body = req.method === "POST" ? parseStripeForm(await readBody(req)) : {};

    if (url.pathname === "/v1/accounts" && req.method === "POST") {
      const key = req.headers["idempotency-key"];
      if (key && accountsByIdempotencyKey.has(key)) return json(res, 200, accounts.get(accountsByIdempotencyKey.get(key)));
      if (body.controller?.stripe_dashboard?.type !== "full" || body.controller?.fees?.payer !== "account") {
        return stripeError(res, 400, "Expected a connected account with its own Stripe Dashboard that pays its own fees");
      }
      const account = { id: newId("acct"), object: "account", email: body.email ?? null, business_profile: body.business_profile ?? {}, charges_enabled: false, details_submitted: false, bank_payments: true, metadata: body.metadata ?? {} };
      accounts.set(account.id, account);
      if (key) accountsByIdempotencyKey.set(key, account.id);
      return json(res, 200, account);
    }
    const accountMatch = /^\/v1\/accounts\/(acct_\w+)$/.exec(url.pathname);
    if (accountMatch && req.method === "GET") {
      const account = accounts.get(accountMatch[1]);
      return account ? json(res, 200, account) : stripeError(res, 404, "No such account");
    }
    if (url.pathname === "/v1/account_links" && req.method === "POST") {
      if (!accounts.has(body.account)) return stripeError(res, 400, "No such account", "account");
      if (body.type !== "account_onboarding") return stripeError(res, 400, "Unsupported type", "type");
      const link = `${BASE}/connect/onboard/${body.account}?return_url=${encodeURIComponent(body.return_url)}`;
      return json(res, 200, { object: "account_link", created: Math.floor(Date.now() / 1000), expires_at: Math.floor(Date.now() / 1000) + 300, url: link });
    }
    if (url.pathname === "/v1/checkout/sessions" && req.method === "POST") {
      const account = accounts.get(req.headers["stripe-account"]);
      if (!account) return stripeError(res, 400, "Direct charges need a Stripe-Account header for a connected account");
      if (!account.charges_enabled) return stripeError(res, 400, "This account can't accept payments yet");
      const methods = body.payment_method_types ?? ["card"];
      if (methods.includes("us_bank_account") && !account.bank_payments) {
        return stripeError(res, 400, "The payment method type us_bank_account is not activated for this account", "payment_method_types");
      }
      const item = body.line_items?.[0];
      const id = newId("cs_test");
      const session = {
        id,
        object: "checkout.session",
        url: `${BASE}/checkout/${id}`,
        mode: body.mode,
        amount_total: Number(item?.price_data?.unit_amount) * Number(item?.quantity ?? 1),
        currency: item?.price_data?.currency,
        description: item?.price_data?.product_data?.name,
        payment_method_types: methods,
        payment_status: "unpaid",
        status: "open",
        client_reference_id: body.client_reference_id ?? null,
        metadata: body.metadata ?? {},
        success_url: body.success_url,
        cancel_url: body.cancel_url,
      };
      sessions.set(id, { session, account: account.id });
      return json(res, 200, session);
    }
    return stripeError(res, 404, `Unrecognized request URL (${req.method}: ${url.pathname})`);
  }

  // --- Stand-in for Stripe's hosted onboarding ---
  const onboard = /^\/connect\/onboard\/(acct_\w+)(\/finish)?$/.exec(url.pathname);
  if (onboard) {
    const account = accounts.get(onboard[1]);
    if (!account) return json(res, 404, { message: "No such account" });
    const returnUrl = url.searchParams.get("return_url");
    if (!onboard[2]) {
      return html(
        res,
        `<h1>Stripe onboarding (test)</h1><p>${account.business_profile?.name ?? ""}</p>
         <form method="post" action="/connect/onboard/${account.id}/finish?return_url=${encodeURIComponent(returnUrl)}"><button name="bank" value="on">Finish setup</button><button name="bank" value="off">Finish setup (card only)</button></form>`,
      );
    }
    const form = new URLSearchParams(await readBody(req));
    Object.assign(account, { charges_enabled: true, details_submitted: true, bank_payments: form.get("bank") !== "off" });
    await sendEvent("account.updated", account, account.id);
    return redirect(res, returnUrl);
  }

  // --- Stand-in for Stripe's hosted Checkout page (card details would be entered here) ---
  const checkout = /^\/checkout\/(cs_test_\w+)(\/pay)?$/.exec(url.pathname);
  if (checkout) {
    const entry = sessions.get(checkout[1]);
    if (!entry) return json(res, 404, { message: "No such checkout session" });
    const { session, account } = entry;
    if (!checkout[2]) {
      const bank = session.payment_method_types.includes("us_bank_account");
      return html(
        res,
        `<h1>Stripe Checkout (test)</h1><p data-testid="checkout-amount">${session.currency?.toUpperCase()} ${(session.amount_total / 100).toFixed(2)}</p><p>${session.description ?? ""}</p>
         <form method="post" action="/checkout/${session.id}/pay"><button name="method" value="card">Pay with card</button>${bank ? '<button name="method" value="bank">Pay by bank</button>' : ""}</form>
         <a href="${session.cancel_url}">Back</a>`,
      );
    }
    if (session.status !== "open") return redirect(res, session.success_url);
    const method = new URLSearchParams(await readBody(req)).get("method");
    Object.assign(session, { status: "complete", payment_status: method === "bank" ? "unpaid" : "paid" });
    await sendEvent("checkout.session.completed", { ...session }, account);
    return redirect(res, session.success_url);
  }

  // --- Test controls ---
  if (url.pathname === "/__stripe/events") return json(res, 200, events);
  const settle = /^\/__stripe\/settle\/(cs_test_\w+)$/.exec(url.pathname);
  if (settle && req.method === "POST") {
    const entry = sessions.get(settle[1]);
    if (!entry) return json(res, 404, {});
    entry.session.payment_status = "paid";
    return json(res, 200, { status: await sendEvent("checkout.session.async_payment_succeeded", { ...entry.session }, entry.account) });
  }
  const resend = /^\/__stripe\/resend\/(evt_\w+)$/.exec(url.pathname);
  if (resend && req.method === "POST") {
    const original = events.find((e) => e.event.id === resend[1]);
    if (!original) return json(res, 404, {});
    return json(res, 200, { status: await sendEvent(original.event.type, original.event.data.object, original.event.account, original.event.id) });
  }
  return null;
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, BASE);
  if (url.pathname === "/health") return json(res, 200, { ok: true });

  if (/^\/(v1|connect|checkout|__stripe)\//.test(url.pathname)) {
    const handled = await handleStripe(req, res, url);
    if (handled !== null) return;
    return json(res, 404, { message: "Not found" });
  }

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

server.listen(PORT, "127.0.0.1", () => console.log(`Fake National Weather Service and Stripe listening on ${PORT}`));
