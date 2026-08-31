import { defineConfig, devices } from "@playwright/test";

// Saved session cookie written by e2e/auth.setup.ts (keep in sync with that file).
const STORAGE_STATE = "e2e/.auth/user.json";

// Load local env files so E2E_PASSWORD / APP_PASSWORD are available to the auth
// setup. process.loadEnvFile is built into Node (no dotenv dependency); ignore
// missing files.
for (const file of [".env", ".env.local"]) {
  try {
    process.loadEnvFile(file);
  } catch {
    // file absent — fine
  }
}

/**
 * End-to-end tests live in ./e2e and run against the Next.js app.
 *
 * `testDir` is deliberately scoped to ./e2e so Playwright does NOT pick up the
 * unit tests under src/ (those are plain node:test files run via `npm test`).
 *
 * Auth: the `setup` project logs in once (e2e/auth.setup.ts) and saves a session
 * cookie; the `chromium` project reuses it via storageState, so specs run as a
 * signed-in user. The login specs work signed-in or not.
 *
 * The webServer block boots `npm run dev` automatically and reuses an
 * already-running dev server locally.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  // One local retry absorbs the dev server's occasional cold-compile error on a
  // route's first hit (a dev-only artifact; production is prebuilt).
  retries: process.env.CI ? 2 : 1,
  workers: process.env.CI ? 1 : undefined,
  reporter: "html",

  // Generous timeouts: the Supabase DB is remote, so under parallel load the
  // heaviest multi-navigation tests need headroom.
  timeout: 90_000,
  expect: { timeout: 15_000 },

  use: {
    baseURL: "http://localhost:3000",
    trace: "on-first-retry",
    navigationTimeout: 30_000,
  },

  projects: [
    // Logs in and writes e2e/.auth/user.json before the authenticated project runs.
    { name: "setup", testMatch: /.*\.setup\.ts/ },

    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], storageState: STORAGE_STATE },
      dependencies: ["setup"],
    },

    // Firefox and WebKit engines are installed too — uncomment to run cross-browser.
    // { name: "firefox", use: { ...devices["Desktop Firefox"], storageState: STORAGE_STATE }, dependencies: ["setup"] },
    // { name: "webkit", use: { ...devices["Desktop Safari"], storageState: STORAGE_STATE }, dependencies: ["setup"] },
  ],

  // Run tests against a PRODUCTION build, not `next dev`. The dev server compiles
  // each route on first hit, which under parallel load caused cold-compile
  // timeouts; a prebuilt server serves instantly. Locally it reuses a server
  // already on :3000 — so for a clean run, don't have `npm run dev` going.
  webServer: {
    command: "npm run build && npm run start",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 240_000,
  },
});
