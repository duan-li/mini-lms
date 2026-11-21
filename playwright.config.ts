import { defineConfig, devices } from "@playwright/test";
import { resolveSupabaseEnv } from "./tests/integration/global-setup";

// End-to-end tests in a real browser, against a production build of the app
// on its own port and in its own build directory (.next-e2e), so a running
// `npm run dev` is left alone. Local Supabase must be running.
//
//   E2E_PORT=3200         port for the app under test
//   E2E_SKIP_BUILD=1      reuse the last build in .next-e2e (faster reruns)

const PORT = Number(process.env.E2E_PORT || 3200);
const BASE_URL = `http://127.0.0.1:${PORT}`;

// Resolved once here; workers inherit the values, so they skip `supabase status`.
const supabase = resolveSupabaseEnv();
process.env.NEXT_PUBLIC_SUPABASE_URL = supabase.url;
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = supabase.publishableKey;
process.env.SUPABASE_SECRET_KEY = supabase.secretKey;

const next = "node node_modules/next/dist/bin/next";
const start = `${next} start --port ${PORT} --hostname 127.0.0.1`;

export default defineConfig({
  testDir: "tests/e2e",
  // The specs share one database and one app; one at a time keeps them simple.
  workers: 1,
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: BASE_URL,
    // Fixed, so the tests can work out the times they type and expect.
    locale: "en-US",
    timezoneId: "UTC",
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: process.env.E2E_SKIP_BUILD === "1" ? start : `${next} build && ${start}`,
    url: `${BASE_URL}/auth/login`,
    reuseExistingServer: false,
    timeout: 240_000,
    env: {
      NODE_ENV: "production",
      NEXT_DIST_DIR: ".next-e2e",
      NEXT_TELEMETRY_DISABLED: "1",
      NEXT_PUBLIC_SUPABASE_URL: supabase.url,
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: supabase.publishableKey,
      // The app never needs the secret key; only the tests use it, to create users.
      SUPABASE_SECRET_KEY: "",
    },
  },
});
