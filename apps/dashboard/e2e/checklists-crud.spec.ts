import { test, expect } from "@playwright/test";

/**
 * Checklist templates — create-then-delete write test.
 *
 * "New template" creates an "Untitled checklist" and opens its editor; we capture
 * its id, then delete it and confirm it's gone from the list. If it fails between
 * create and delete, a stray "Untitled checklist" template may remain.
 */
test.describe("checklist templates (write)", () => {
  test("can create a template and delete it", async ({ page }) => {
    await page.goto("/dashboard/checklists");
    await expect(page.getByRole("heading", { name: "QA checklists" })).toBeVisible({
      timeout: 30_000,
    });

    // --- create (redirects to the new template's editor) ---
    await page.getByRole("button", { name: "New template" }).click();
    await expect(page).toHaveURL(/\/dashboard\/checklists\/[^/]+$/);
    const newId = page.url().split("/").pop()!;
    await expect(
      page.getByRole("heading", { name: "Untitled checklist" }),
    ).toBeVisible();

    // --- delete from the editor ---
    await page.getByRole("button", { name: "Delete template" }).click();
    await page.getByRole("button", { name: "Delete", exact: true }).click();

    // Back on the list, the new template is gone.
    await expect(page).toHaveURL(/\/dashboard\/checklists$/);
    await expect(
      page.locator(`a[href="/dashboard/checklists/${newId}"]`),
    ).toHaveCount(0);
  });
});
