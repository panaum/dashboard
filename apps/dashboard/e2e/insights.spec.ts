import { test, expect } from "@playwright/test";

/**
 * Insights — verifies the page renders its headline tiles and analysis sections
 * (the aggregation maths behind them is unit-tested in src/lib/insights.test.ts).
 */
test.describe("insights", () => {
  test("renders the headline tiles and analysis sections", async ({ page }) => {
    await page.goto("/dashboard/insights");
    await expect(page.getByRole("heading", { name: "Insights" })).toBeVisible({
      timeout: 30_000,
    });

    for (const tile of ["Pages", "Avg issues / page", "On-time delivery", "Repetitive bugs"]) {
      await expect(page.getByText(tile, { exact: true })).toBeVisible();
    }

    for (const section of ["Quality by platform", "Quality trend", "Developer quality"]) {
      await expect(page.getByRole("heading", { name: section })).toBeVisible();
    }
  });
});
