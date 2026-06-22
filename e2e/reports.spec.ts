import { test, expect, type Page } from "@playwright/test";

/**
 * Monthly report invariants.
 *
 * These assert that the headline numbers equal the parts they're made of, rather
 * than hard-coding magic values — so they survive data changes but still catch a
 * miscount, a broken join dropping rows, or a filter that silently stops working.
 *
 * Note: the KPI tiles use <AnimatedNumber> (counts up over ~0.8s), so we let them
 * settle before reading. The severity counts and table cells are static, so their
 * sums are read immediately and cross-checked against each other too.
 */

const sumText = async (page: Page, locator: string): Promise<number> => {
  const els = page.locator(locator);
  const n = await els.count();
  let sum = 0;
  for (let i = 0; i < n; i++) {
    sum += Number((await els.nth(i).innerText()).replace(/\D/g, "")) || 0;
  }
  return sum;
};

/** Reads a settled KPI tile value by its unit label (e.g. "Total issues"). */
const kpiValue = async (page: Page, unit: string): Promise<number> => {
  const value = page
    .getByText(unit, { exact: true })
    .locator("xpath=following-sibling::div[1]");
  return Number((await value.innerText()).replace(/[^\d.]/g, ""));
};

async function assertInvariants(page: Page) {
  // The table only renders when the selected month has pages.
  await expect(page.locator("table")).toBeVisible({ timeout: 30_000 });

  // --- static sources (no animation) ---
  const sevCard =
    'xpath=//h2[normalize-space()="Issues by severity"]/ancestor::div[contains(@class,"rounded-xl")][1]';
  const severitySum = await sumText(page, `${sevCard}//span[contains(@class,"text-right")]`);

  const rows = page.locator("table tbody tr");
  const rowCount = await rows.count();
  let tableIssues = 0;
  for (let i = 0; i < rowCount; i++) {
    // Columns: Page · Client · Developer · Tester · Issues · Delay → Issues is index 4.
    const cell = rows.nth(i).locator("td").nth(4);
    tableIssues += Number((await cell.innerText()).replace(/\D/g, "")) || 0;
  }

  // Two independent static sources must already agree.
  expect(
    severitySum,
    "severity bars should sum to the same total as the table's Issues column",
  ).toBe(tableIssues);

  // --- animated KPIs: let the count-up finish, then compare ---
  await page.waitForTimeout(1500);
  const totalIssuesKpi = await kpiValue(page, "Total issues");
  const pagesDeliveredKpi = await kpiValue(page, "Pages delivered");

  expect(
    totalIssuesKpi,
    "Total issues KPI should equal the sum of the severity bars",
  ).toBe(severitySum);
  expect(
    pagesDeliveredKpi,
    "Pages delivered KPI should equal the number of rows in the delivery table",
  ).toBe(rowCount);
}

test.describe("monthly report", () => {
  test("headline KPIs equal the sum of their parts (default month)", async ({
    page,
  }) => {
    await page.goto("/dashboard/reports");
    await assertInvariants(page);
  });

  test("switching months re-filters and the invariants still hold", async ({
    page,
  }) => {
    await page.goto("/dashboard/reports");
    await expect(page.locator("table")).toBeVisible({ timeout: 30_000 });

    const monthTabs = page.locator('a[href*="/dashboard/reports?month="]');
    const tabCount = await monthTabs.count();
    test.skip(tabCount < 2, "needs at least two months of data to switch between");

    // Click the last (oldest) month tab — guaranteed different from the default newest.
    const lastTab = monthTabs.nth(tabCount - 1);
    const href = await lastTab.getAttribute("href");
    const month = href?.match(/month=([\d-]+)/)?.[1];
    await lastTab.click();

    await expect(page).toHaveURL(new RegExp(`month=${month}$`));
    await assertInvariants(page);
  });
});
