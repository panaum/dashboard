import { test, expect } from "@playwright/test";

/**
 * These run as a signed-in user — the chromium project loads the session cookie
 * saved by auth.setup.ts, so /dashboard/* is reachable without redirecting to
 * /login.
 */
test.describe("dashboard (authenticated)", () => {
  test("loads the overview without redirecting to login", async ({ page }) => {
    await page.goto("/dashboard");

    // Stayed on the dashboard (an unauthenticated request would bounce to /login).
    await expect(page).toHaveURL(/\/dashboard$/);

    // Sidebar nav is present — "Insights" is a unique label.
    await expect(
      page.getByRole("link", { name: "Insights" }),
    ).toBeVisible();
  });

  test("can navigate to the Insights page", async ({ page }) => {
    await page.goto("/dashboard");
    await page.getByRole("link", { name: "Insights" }).click();

    await expect(page).toHaveURL(/\/dashboard\/insights$/);
    await expect(
      page.getByRole("heading", { name: "Insights" }),
    ).toBeVisible();
  });
});
