import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests live in ./e2e and run against the Next.js app.
 *
 * `testDir` is deliberately scoped to ./e2e so Playwright does NOT pick up the
 * unit tests under src/ (those are plain node:test files run via `npm test`).
 *
 * The webServer block boots `npm run dev` automatically for a test run and
 * reuses an already-running dev server locally, so `npm run e2e` works whether
 * or not you already have the app open.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: "html",

  use: {
    baseURL: "http://localhost:3000",
    trace: "on-first-retry",
  },

  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    // Firefox and WebKit engines are installed too — uncomment to run cross-browser.
    // { name: "firefox", use: { ...devices["Desktop Firefox"] } },
    // { name: "webkit", use: { ...devices["Desktop Safari"] } },
  ],

  webServer: {
    command: "npm run dev",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
