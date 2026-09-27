import { execFileSync } from "node:child_process";
import { randomInt } from "node:crypto";

import { createClient } from "@supabase/supabase-js";

import type { Database } from "../../src/lib/supabase/database.types";

// Shared by playwright.config.ts and the tests: the fake OpenWeather/Twilio server
// (tests/e2e/fake-services.mjs) and the credentials the app is given to talk to it.
export const FAKE_SERVICES_PORT = 4010;
const FAKE_URL = `http://127.0.0.1:${FAKE_SERVICES_PORT}`;

export const FAKE_ENV = {
  FAKE_SERVICES_PORT: String(FAKE_SERVICES_PORT),
  OPENWEATHER_API_KEY: "test-openweather-key",
  OPENWEATHER_BASE_URL: FAKE_URL,
  // Always fetch, so a forecast cached on an earlier day can't leak into a test.
  OPENWEATHER_CACHE_SECONDS: "0",
  TWILIO_ACCOUNT_SID: "AC00000000000000000000000000000000",
  TWILIO_AUTH_TOKEN: "test-twilio-auth-token",
  TWILIO_API_BASE_URL: FAKE_URL,
};

// What the fake forecast says for each ZIP code: the chance of rain today, tomorrow, and
// the day after (see PLACES in fake-services.mjs).
export const FAKE_PLACES = {
  lakeRonkonkoma: { zip: "11779", name: "Lake Ronkonkoma", rain: [10, 80, 30] },
  newYork: { zip: "10001", name: "New York", rain: [5, 20, 65] },
  beverlyHills: { zip: "90210", name: "Beverly Hills", rain: [0, 0, 0] },
  outage: { zip: "59001", name: "Outage Falls", rain: null },
};

// Numbers the fake Twilio treats specially.
export const UNSUBSCRIBED_NUMBER = "+12025550666"; // refused: they replied STOP
export const UNDELIVERABLE_NUMBER = "+12025550777"; // accepted, then undelivered

// The local Supabase stack's URL and secret key (the app's webhooks need the secret key,
// and tests use it to assign texting numbers, which only the operator can do).
export function localSupabase() {
  if (!process.env.E2E_SUPABASE_URL || !process.env.SUPABASE_SECRET_KEY) {
    let status: Record<string, string>;
    try {
      status = JSON.parse(execFileSync("npx", ["supabase", "status", "-o", "json"], { encoding: "utf8" }));
    } catch (error) {
      throw new Error("Local Supabase isn't running. Start it with `npx supabase start`, then re-run the tests.", {
        cause: error,
      });
    }
    process.env.E2E_SUPABASE_URL = status.API_URL;
    process.env.SUPABASE_SECRET_KEY = status.SECRET_KEY;
  }
  return { url: process.env.E2E_SUPABASE_URL!, secretKey: process.env.SUPABASE_SECRET_KEY! };
}

function adminClient() {
  const { url, secretKey } = localSupabase();
  return createClient<Database>(url, secretKey, { auth: { persistSession: false, autoRefreshToken: false } });
}

// A random US number, unique per run.
export const randomNumber = () => `+1${randomInt(200, 999)}${String(randomInt(0, 10_000_000)).padStart(7, "0")}`;

// Gives the business owned by ownerEmail a texting number, the way the operator would
// (service role). The owner's crew record carries their email.
export async function assignTextingNumber(ownerEmail: string, phone = randomNumber()) {
  const admin = adminClient();
  const { data: owner, error } = await admin.from("crew_members").select("business_id").eq("email", ownerEmail).single();
  if (error) throw new Error(`No business for ${ownerEmail}: ${error.message}`);
  const { error: insertError } = await admin.from("sms_senders").insert({ business_id: owner.business_id, phone_number: phone });
  if (insertError) throw new Error(insertError.message);
  return phone;
}

export type FakeText = {
  sid: string;
  to: string;
  from: string;
  body: string;
  statusCallback: string | null;
  callbacks: { status: string; httpStatus?: number }[];
};

// Every text the fake Twilio has received from a given number.
export async function textsFrom(from: string): Promise<FakeText[]> {
  const all = (await (await fetch(`${FAKE_URL}/__twilio/messages`)).json()) as FakeText[];
  return all.filter((m) => m.from === from);
}
