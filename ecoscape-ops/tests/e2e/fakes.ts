import { execFileSync } from "node:child_process";
import { randomInt } from "node:crypto";

// Shared by playwright.config.ts and the tests: the fake National Weather Service and
// Stripe (tests/e2e/fake-services.mjs) and the settings the app is given to talk to them.
export const FAKE_SERVICES_PORT = 4010;
export const FAKE_URL = `http://127.0.0.1:${FAKE_SERVICES_PORT}`;

export const FAKE_ENV = {
  FAKE_SERVICES_PORT: String(FAKE_SERVICES_PORT),
  NWS_BASE_URL: FAKE_URL,
  // Always fetch, so a forecast cached on an earlier day can't leak into a test.
  WEATHER_CACHE_SECONDS: "0",
  STRIPE_SECRET_KEY: "sk_test_ecoscape_e2e",
  STRIPE_WEBHOOK_SECRET: "whsec_ecoscape_e2e",
  STRIPE_API_BASE_URL: FAKE_URL,
  APP_WEBHOOK_URL: "http://localhost:3000/api/stripe/webhook",
};

// What the fake forecast says for each ZIP code: the chance of rain today, tomorrow, and
// the day after (see PLACES in fake-services.mjs).
export const FAKE_PLACES = {
  ronkonkoma: { zip: "11779", name: "Ronkonkoma, NY", rain: [10, 80, 30] },
  newYork: { zip: "10001", name: "New York, NY", rain: [5, 20, 65] },
  beverlyHills: { zip: "90210", name: "Beverly Hills, CA", rain: [0, 0, 0] },
  outage: { zip: "59001", name: "Absarokee, MT", rain: null },
};

// A random US number.
export const randomNumber = () => `+1${randomInt(200, 999)}${String(randomInt(0, 10_000_000)).padStart(7, "0")}`;

// The local Supabase stack's secret key, which the app's Stripe webhook needs.
export function localSupabaseSecretKey() {
  if (!process.env.SUPABASE_SECRET_KEY) {
    let status: Record<string, string>;
    try {
      status = JSON.parse(execFileSync("npx", ["supabase", "status", "-o", "json"], { encoding: "utf8" }));
    } catch (error) {
      throw new Error("Local Supabase isn't running. Start it with `npx supabase start`, then re-run the tests.", { cause: error });
    }
    process.env.SUPABASE_SECRET_KEY = status.SECRET_KEY;
  }
  return process.env.SUPABASE_SECRET_KEY;
}

type FakeEvent = { event: { id: string; type: string; account: string; data: { object: { id: string } } }; status: number | string };

// Every webhook event the fake Stripe has sent the app, and how the app answered.
export async function stripeEvents(): Promise<FakeEvent[]> {
  return (await fetch(`${FAKE_URL}/__stripe/events`)).json();
}

export async function resendStripeEvent(eventId: string) {
  return (await fetch(`${FAKE_URL}/__stripe/resend/${eventId}`, { method: "POST" })).json();
}

// A bank payment clearing, days later.
export async function settleBankPayment(sessionId: string) {
  return (await fetch(`${FAKE_URL}/__stripe/settle/${sessionId}`, { method: "POST" })).json();
}
