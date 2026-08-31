import { test, expect } from "@playwright/test";

/**
 * /dashboard/search was merged into /dashboard/insights. The route survives as
 * a redirect so old links and bookmarks keep working; this pins that contract.
 *
 * NOTE: this spec used to cover a `?q=` text query on the search page (a guard
 * against Postgres LIKE being case-sensitive). That filter is not in the page
 * any more — finding a page by name is ⌘K's job — so there is nothing left here
 * to case-check. If a text filter comes back, restore that test with it.
 */
test.describe("search route", () => {
  test("redirects to insights and keeps the filters", async ({ page }) => {
    await page.goto("/dashboard/search?status=LIVE&scope=all");
    await expect(page).toHaveURL(/\/dashboard\/insights\?/, { timeout: 30_000 });

    const url = new URL(page.url());
    expect(url.searchParams.get("status")).toBe("LIVE");
    expect(url.searchParams.get("scope")).toBe("all");
    await expect(page.getByRole("heading", { name: "Insights" })).toBeVisible();
  });

  test("redirects the bare route", async ({ page }) => {
    await page.goto("/dashboard/search");
    await expect(page).toHaveURL(/\/dashboard\/insights$/, { timeout: 30_000 });
  });
});
