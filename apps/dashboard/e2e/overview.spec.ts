import { test, expect, type Page } from "@playwright/test";

/**
 * Overview (the landing screen) — invariant checks rather than magic numbers, so
 * they survive data changes but still catch a broken count, a miscategorised
 * status, or a severity that silently drops out of the chart.
 */

/** Reads a settled stat-tile value by its label, scoped to the top stats rail
 *  (so "In QA" matches the tile, not the identically-named pipeline row). */
const tileInt = async (page: Page, label: string): Promise<number> => {
  const value = page
    .locator(".grid-cols-5")
    .getByText(label, { exact: true })
    .locator("xpath=following-sibling::div[1]");
  return Number((await value.innerText()).replace(/\D/g, ""));
};

/** Sums the trailing count spans inside the card with the given heading. */
const cardCountSum = async (page: Page, heading: string): Promise<number> => {
  const els = page.locator(
    `xpath=//h2[normalize-space()="${heading}"]/ancestor::div[contains(@class,"rounded-xl")][1]//span[contains(@class,"text-right")]`,
  );
  const n = await els.count();
  let sum = 0;
  for (let i = 0; i < n; i++) {
    sum += Number((await els.nth(i).innerText()).replace(/\D/g, "")) || 0;
  }
  return sum;
};

test.describe("overview", () => {
  test("the five stat tiles show valid, consistent numbers", async ({ page }) => {
    await page.goto("/dashboard");
    // Wait for the rail, then let the count-up animations settle before reading.
    await expect(page.locator(".grid-cols-5")).toBeVisible({ timeout: 30_000 });
    await page.waitForTimeout(1500);

    const labels = ["Clients", "Projects", "Pages", "In QA", "Open issues"];
    const values: Record<string, number> = {};
    for (const l of labels) {
      const v = await tileInt(page, l);
      expect(Number.isFinite(v), `${l} tile should be a number`).toBe(true);
      expect(v, `${l} tile should be non-negative`).toBeGreaterThanOrEqual(0);
      values[l] = v;
    }

    // Pages in QA are a subset of all pages.
    expect(values["In QA"], "In QA should not exceed total Pages").toBeLessThanOrEqual(
      values["Pages"],
    );
  });

  test("the severity and pipeline charts are internally consistent", async ({
    page,
  }) => {
    await page.goto("/dashboard");
    await expect(page.locator(".grid-cols-5")).toBeVisible({ timeout: 30_000 });

    // "Issues by severity": the four bars sum to the "N total" shown beside the heading.
    const severitySum = await cardCountSum(page, "Issues by severity");
    const totalText = await page
      .locator('xpath=//h2[normalize-space()="Issues by severity"]/following-sibling::span[1]')
      .innerText();
    const totalIssues = Number(totalText.replace(/\D/g, ""));
    expect(
      severitySum,
      "severity bars should sum to the issues total beside the heading",
    ).toBe(totalIssues);

    // "Delivery pipeline": the status counts sum to the Pages tile.
    await page.waitForTimeout(1500);
    const pipelineSum = await cardCountSum(page, "Delivery pipeline");
    const pages = await tileInt(page, "Pages");
    expect(
      pipelineSum,
      "delivery-pipeline status counts should sum to total Pages",
    ).toBe(pages);
  });
});
