import { test, expect } from "@playwright/test";

/**
 * Clients directory — the client-side filter box and drill-down links.
 */
test.describe("clients", () => {
  test("filter box narrows the list and shows an empty state for no match", async ({
    page,
  }) => {
    await page.goto("/dashboard/clients");
    const cards = page.locator('a[href^="/dashboard/clients/"]');
    await expect(cards.first()).toBeVisible({ timeout: 30_000 });

    const total = await cards.count();
    expect(total).toBeGreaterThan(0);

    // Filter by a token from the first client's name → narrows but keeps matches.
    const name = (await cards.first().locator("span.font-medium").first().innerText()).trim();
    const token = name.match(/[A-Za-z]{3,}/)?.[0] ?? name;
    await page.getByPlaceholder("Filter clients…").fill(token);
    const filtered = await cards.count();
    expect(filtered).toBeGreaterThan(0);
    expect(filtered).toBeLessThanOrEqual(total);

    // A nonsense term shows the empty state and no cards.
    await page.getByPlaceholder("Filter clients…").fill("zzzz-no-such-client");
    await expect(page.getByText(/No clients match/)).toBeVisible();
    await expect(cards).toHaveCount(0);
  });

  test("a client card links to its detail page", async ({ page }) => {
    await page.goto("/dashboard/clients");
    const first = page.locator('a[href^="/dashboard/clients/"]').first();
    await expect(first).toBeVisible({ timeout: 30_000 });

    const href = await first.getAttribute("href");
    expect(href).toMatch(/^\/dashboard\/clients\/[^/]+$/);

    await first.click();
    await expect(page).toHaveURL(/\/dashboard\/clients\/[^/]+$/);
  });
});
