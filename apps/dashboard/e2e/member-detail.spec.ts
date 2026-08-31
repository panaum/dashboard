import { test, expect } from "@playwright/test";

/**
 * Team member detail — the "Pages built" / "Pages QA'd" tiles must agree with
 * the counts on the corresponding page-list sections (both derive from the same
 * data, so a mismatch means a real bug).
 */
test.describe("member detail", () => {
  test("stat tiles agree with the built / QA'd list headings", async ({ page }) => {
    await page.goto("/dashboard/team");
    const first = page.locator('a[href^="/dashboard/team/"]').first();
    await expect(first).toBeVisible({ timeout: 30_000 });
    await first.click();
    await expect(page).toHaveURL(/\/dashboard\/team\/[^/]+$/);

    const tile = async (label: string) =>
      Number(
        (
          await page.getByText(label, { exact: true }).locator("xpath=following-sibling::div[1]").innerText()
        ).replace(/\D/g, ""),
      );
    const headingCount = async (re: RegExp) => {
      const txt = await page.getByRole("heading", { name: re }).innerText();
      return Number(txt.match(/\((\d+)/)![1]);
    };

    const builtTile = await tile("Pages built");
    const qadTile = await tile("Pages QA'd");

    expect(await headingCount(/^Built/), "Built section count == Pages built tile").toBe(
      builtTile,
    );
    expect(await headingCount(/^QA'd/), "QA'd section count == Pages QA'd tile").toBe(
      qadTile,
    );
  });
});
