import { test, expect, type Page } from "@playwright/test";

/**
 * Team page — read-only invariants. The stat tiles use <AnimatedNumber>, so let
 * them settle before reading.
 */

const tileInt = async (page: Page, label: string): Promise<number> => {
  const value = page
    .getByText(label, { exact: true })
    .locator("xpath=following-sibling::div[1]");
  return Number((await value.innerText()).replace(/\D/g, ""));
};

test.describe("team", () => {
  test("stat tiles agree with the member table", async ({ page }) => {
    await page.goto("/dashboard/team");
    await expect(page.getByText("People", { exact: true })).toBeVisible({
      timeout: 30_000,
    });
    await page.waitForTimeout(1500);

    const people = await tileInt(page, "People");
    const developers = await tileInt(page, "Developers");
    const built = await tileInt(page, "Pages built");

    for (const [name, v] of [
      ["People", people],
      ["Developers", developers],
      ["Pages built", built],
    ] as const) {
      expect(Number.isFinite(v), `${name} should be a number`).toBe(true);
      expect(v, `${name} should be non-negative`).toBeGreaterThanOrEqual(0);
    }

    // Developers are a subset of all people.
    expect(developers, "Developers should not exceed People").toBeLessThanOrEqual(people);

    // One table row per person.
    const rows = page.locator('a[href^="/dashboard/team/"]');
    expect(await rows.count(), "team table should have one row per person").toBe(people);
  });
});
