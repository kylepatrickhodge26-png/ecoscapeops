import { defineConfig, devices } from "@playwright/test";

import { FAKE_ENV, FAKE_SERVICES_PORT, localSupabase } from "./tests/e2e/fakes";

// Optional: point at an already-installed Chromium instead of Playwright's download.
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
const PORT = 3000;

// Needs the local Supabase stack running (`npx supabase start`) and .env.local. The
// secret key is read from the stack for the app's Twilio webhooks.
const { secretKey } = localSupabase();

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "desktop",
      use: { ...devices["Desktop Chrome"], launchOptions: executablePath ? { executablePath } : {} },
    },
    {
      name: "mobile",
      use: { ...devices["Pixel 7"], launchOptions: executablePath ? { executablePath } : {} },
    },
  ],
  webServer: [
    // Fake OpenWeather and Twilio, so tests never touch the real services.
    {
      command: "node tests/e2e/fake-services.mjs",
      url: `http://127.0.0.1:${FAKE_SERVICES_PORT}/health`,
      reuseExistingServer: !process.env.CI,
      env: FAKE_ENV,
    },
    {
      command: `npm run build && npm run start -- --port ${PORT}`,
      url: `http://localhost:${PORT}/login`,
      reuseExistingServer: !process.env.CI,
      timeout: 240_000,
      env: { ...FAKE_ENV, SUPABASE_SECRET_KEY: secretKey },
    },
  ],
});
