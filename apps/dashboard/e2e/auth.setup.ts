import { test as setup, expect } from "@playwright/test";

/**
 * Logs in once through the real login form and saves the resulting signed
 * `session` cookie to storageState, so authenticated specs can reuse it instead
 * of logging in for every test.
 *
 * The password must match the running dev server's APP_PASSWORD (that's what the
 * form validates against). Set E2E_PASSWORD in .env / .env.local to override;
 * otherwise it falls back to APP_PASSWORD. The config auto-loads those files.
 */
export const STORAGE_STATE = "e2e/.auth/user.json";

setup("authenticate", async ({ page }) => {
  const password = process.env.E2E_PASSWORD ?? process.env.APP_PASSWORD;
  if (!password) {
    throw new Error(
      "No test password found. Set E2E_PASSWORD (or APP_PASSWORD) in .env / .env.local — " +
        "it must equal the running server's APP_PASSWORD.",
    );
  }

  await page.goto("/login");
  await page.getByLabel("Team password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();

  // A correct password redirects to the dashboard; a wrong one stays on /login
  // and shows an error. Allow a generous timeout: on a cold dev server the
  // /dashboard route compiles on first hit and the Supabase DB is remote, so the
  // round-trip can take well over the default 5s.
  await expect(
    page,
    "Login did not redirect to /dashboard — is the test password correct?",
  ).toHaveURL(/\/dashboard$/, { timeout: 60_000 });

  await page.context().storageState({ path: STORAGE_STATE });
});
