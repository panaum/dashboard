import { test, expect } from "@playwright/test";

/**
 * Clients — create-then-delete write test.
 *
 * Adds a uniquely-named client via the dialog, opens its detail page, then
 * deletes it and confirms it's gone from the directory. If it fails between
 * create and delete, a stray "__e2e client …" may remain.
 */
test.describe("clients (write)", () => {
  test("can add a client and delete it", async ({ page }) => {
    const name = `__e2e client ${Date.now()}`;

    await page.goto("/dashboard/clients");
    await expect(page.getByRole("heading", { name: "Clients" })).toBeVisible({
      timeout: 30_000,
    });

    // --- create ---
    await page.getByRole("button", { name: "New client" }).click();
    await page.getByLabel("Client name").fill(name);
    await page.getByRole("button", { name: "Save" }).click();

    // The new client appears; open its detail page.
    const card = page
      .locator('a[href^="/dashboard/clients/"]')
      .filter({ hasText: name });
    await expect(card).toBeVisible();
    await card.click();
    await expect(page.getByRole("heading", { name }).first()).toBeVisible();

    // --- delete ---
    await page.getByRole("button", { name: "Delete client" }).click();
    await page.getByRole("button", { name: "Delete", exact: true }).click();

    // Back on the directory, the client is gone.
    await expect(page).toHaveURL(/\/dashboard\/clients$/);
    await expect(
      page.locator('a[href^="/dashboard/clients/"]').filter({ hasText: name }),
    ).toHaveCount(0);
  });
});
