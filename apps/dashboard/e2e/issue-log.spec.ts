import { test, expect } from "@playwright/test";

/**
 * Page-detail QA workflow — issue log (the core "log a bug" loop).
 *
 * Create-then-delete against a real page: adds a uniquely-titled issue, asserts
 * it appears, then deletes exactly that issue (net-zero on the page). If it fails
 * between create and delete, a stray "__e2e issue …" may remain — the prefix
 * makes it easy to find.
 */
test.describe("issue log (write)", () => {
  test("can add an issue to a page and remove it", async ({ page }) => {
    const title = `__e2e issue ${Date.now()}`;

    // Open any page detail (issue log renders on every page).
    await page.goto("/dashboard/search?q=a");
    const href = await page
      .locator('a[href^="/dashboard/clients/"]')
      .first()
      .getAttribute("href");
    expect(href, "search should return a page to open").toBeTruthy();

    await page.goto(href!);
    await expect(page.getByRole("heading", { name: "Issues" })).toBeVisible({
      timeout: 30_000,
    });

    // --- create ---
    await page.getByRole("button", { name: "Add issue" }).click();
    await page.getByLabel("Title").fill(title);
    await page.getByRole("button", { name: "Save" }).click();

    await expect(page.getByText(title, { exact: true })).toBeVisible();

    // --- delete the issue we just created ---
    const row = page
      .getByText(title, { exact: true })
      .locator('xpath=ancestor::div[.//button[@aria-label="Delete issue"]][1]');
    await row.getByRole("button", { name: "Delete issue" }).click();
    await page.getByRole("button", { name: "Delete", exact: true }).click();

    // Deletion is a DB write + revalidate; allow extra time under parallel load.
    await expect(page.getByText(title, { exact: true })).toHaveCount(0, {
      timeout: 30_000,
    });
  });
});
