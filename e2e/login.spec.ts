import { test, expect } from "@playwright/test";

/**
 * Smoke test for the public login page.
 *
 * /login is the right target for a no-auth smoke test: every /dashboard/* route
 * redirects unauthenticated requests to /login (see src/proxy.ts), so this page
 * is the one guaranteed-reachable entry point without a session cookie.
 */
test.describe("login page", () => {
  test("loads and shows the sign-in form", async ({ page }) => {
    await page.goto("/login");

    // Branded heading is present.
    await expect(
      page.getByRole("heading", { name: "Deliverables Dashboard" }),
    ).toBeVisible();

    // The password field and submit button render.
    await expect(page.getByLabel("Team password")).toBeVisible();
    await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
  });

  test("rejects an empty submission (HTML required validation)", async ({
    page,
  }) => {
    await page.goto("/login");

    const password = page.getByLabel("Team password");
    await page.getByRole("button", { name: "Sign in" }).click();

    // The required password input blocks submission, so we stay on /login.
    await expect(page).toHaveURL(/\/login$/);
    await expect(password).toBeFocused();
  });

  test("rejects a wrong password with an error", async ({ page }) => {
    await page.goto("/login");

    await page.getByLabel("Team password").fill("definitely-not-the-password");
    await page.getByRole("button", { name: "Sign in" }).click();

    await expect(page.getByText("Incorrect password.")).toBeVisible();
    await expect(page).toHaveURL(/\/login$/);
  });
});
