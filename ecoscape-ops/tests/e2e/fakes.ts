import { randomInt } from "node:crypto";

// Shared by playwright.config.ts and the tests: the fake OpenWeather server
// (tests/e2e/fake-services.mjs) and the settings the app is given to talk to it.
export const FAKE_SERVICES_PORT = 4010;

export const FAKE_ENV = {
  FAKE_SERVICES_PORT: String(FAKE_SERVICES_PORT),
  OPENWEATHER_API_KEY: "test-openweather-key",
  OPENWEATHER_BASE_URL: `http://127.0.0.1:${FAKE_SERVICES_PORT}`,
  // Always fetch, so a forecast cached on an earlier day can't leak into a test.
  OPENWEATHER_CACHE_SECONDS: "0",
};

// What the fake forecast says for each ZIP code: the chance of rain today, tomorrow, and
// the day after (see PLACES in fake-services.mjs).
export const FAKE_PLACES = {
  lakeRonkonkoma: { zip: "11779", name: "Lake Ronkonkoma", rain: [10, 80, 30] },
  newYork: { zip: "10001", name: "New York", rain: [5, 20, 65] },
  beverlyHills: { zip: "90210", name: "Beverly Hills", rain: [0, 0, 0] },
  outage: { zip: "59001", name: "Outage Falls", rain: null },
};

// A random US number.
export const randomNumber = () => `+1${randomInt(200, 999)}${String(randomInt(0, 10_000_000)).padStart(7, "0")}`;
