import { test, expect } from "@playwright/test";

/**
 * Create-then-delete write test against the live database.
 *
 * Uses a uniquely-named throwaway member (prefixed __e2e) and removes it via the
 * UI in the same test, so it only ever touches the row it created. If the test
 * fails between create and delete, a stray "__e2e member …" row may remain — the
 * prefix makes it easy to spot and clean up.
 */
test.describe("team (write)", () => {
  test("can add a team member and then remove it", async ({ page }) => {
    const name = `__e2e member ${Date.now()}`;

    await page.goto("/dashboard/team");
    await expect(page.getByText("People", { exact: true })).toBeVisible({
      timeout: 30_000,
    });

    // --- create ---
    await page.getByRole("button", { name: "New member" }).click();
    await page.getByLabel("Name").fill(name);
    await page.getByRole("button", { name: "Save" }).click();

    // The new member shows up in the table.
    await expect(page.getByText(name, { exact: true })).toBeVisible();

    // --- delete (same row we just created) ---
    const row = page
      .getByText(name, { exact: true })
      .locator('xpath=ancestor::div[.//button[@aria-label="Delete member"]][1]');
    await row.getByRole("button", { name: "Delete member" }).click();

    // Confirm in the dialog ("Delete", not the row's "Delete member").
    await page.getByRole("button", { name: "Delete", exact: true }).click();

    // The member is gone again.
    await expect(page.getByText(name, { exact: true })).toHaveCount(0);
  });
});
