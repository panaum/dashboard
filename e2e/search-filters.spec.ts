import { test, expect, type Page } from "@playwright/test";

/**
 * Search filters — correctness via cross-checks, not magic numbers.
 */

const resultCount = async (page: Page): Promise<number> => {
  const txt = await page.getByText(/\d+\s+results?/).first().innerText();
  return Number(txt.match(/(\d+)\s+results?/)?.[1] ?? "0");
};

test.describe("search filters", () => {
  test("developer filter returns exactly that developer's built pages", async ({
    page,
  }) => {
    // Open the first team member and read their built count + id.
    await page.goto("/dashboard/team");
    const member = page.locator('a[href^="/dashboard/team/"]').first();
    await expect(member).toBeVisible({ timeout: 30_000 });
    await member.click();
    await expect(page).toHaveURL(/\/dashboard\/team\/[^/]+$/);
    const id = page.url().split("/").pop()!;

    const builtTile = page
      .getByText("Pages built", { exact: true })
      .locator("xpath=following-sibling::div[1]");
    const built = Number((await builtTile.innerText()).replace(/\D/g, ""));

    // The search caps at 100 rows; only cross-check when it can't be truncated.
    test.skip(built > 100, "developer has more built pages than the result cap");

    // Searching by this developer must return exactly their built pages.
    await page.goto(`/dashboard/search?developerId=${id}`);
    expect(await resultCount(page)).toBe(built);
  });

  test("clearing filters returns to the empty prompt", async ({ page }) => {
    await page.goto("/dashboard/search?q=a");
    await expect(page.getByText(/\d+\s+results?/)).toBeVisible({ timeout: 30_000 });

    await page.getByRole("link", { name: "Clear" }).click();

    await expect(page).toHaveURL(/\/dashboard\/search$/);
    await expect(
      page.getByText("Enter a search term or pick a filter"),
    ).toBeVisible();
  });
});
