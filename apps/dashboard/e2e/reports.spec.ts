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

/** Minimal RFC-4180 parser: handles quoting, doubled quotes, commas/newlines in
 *  fields, CRLF, and a leading BOM. Enough to verify the exported CSV. */
function parseCsv(text: string): string[][] {
  const s = text.replace(/^﻿/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"' && s[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') inQuotes = false;
      else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else if (c !== "\r") field += c;
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  return rows;
}

/** Sums the "Issues" column of the visible delivery table and returns the row count. */
async function readTable(page: Page) {
  const rows = page.getByRole("table").locator("tbody tr");
  const rowCount = await rows.count();
  let issues = 0;
  for (let i = 0; i < rowCount; i++) {
    // Columns: Page · Client · Developer · Tester · Issues · Delay → Issues is index 4.
    issues += Number((await rows.nth(i).locator("td").nth(4).innerText()).replace(/\D/g, "")) || 0;
  }
  return { rowCount, issues };
}

async function assertInvariants(page: Page) {
  // The table only renders when the selected month has pages.
  // getByRole ignores the prod build's hidden <table hidden> artifacts.
  await expect(page.getByRole("table")).toBeVisible({ timeout: 30_000 });

  // --- static sources (no animation) ---
  const sevCard =
    'xpath=//h2[normalize-space()="Issues by severity"]/ancestor::div[contains(@class,"rounded-xl")][1]';
  const severitySum = await sumText(page, `${sevCard}//span[contains(@class,"text-right")]`);

  const { rowCount, issues: tableIssues } = await readTable(page);

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
    // getByRole ignores the prod build's hidden <table hidden> artifacts.
  await expect(page.getByRole("table")).toBeVisible({ timeout: 30_000 });

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

  test("Export CSV matches the report's filtered data", async ({ page }) => {
    await page.goto("/dashboard/reports");
    // getByRole ignores the prod build's hidden <table hidden> artifacts.
  await expect(page.getByRole("table")).toBeVisible({ timeout: 30_000 });

    // What the page currently shows.
    const { rowCount, issues: tableIssues } = await readTable(page);

    // Fetch the export through the same authenticated session as the page.
    const href = await page
      .getByRole("link", { name: /Export CSV/ })
      .getAttribute("href");
    expect(href, "Export CSV link should be present when a month has pages").toBeTruthy();

    const res = await page.request.get(href!);
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toMatch(/text\/csv/);
    expect(res.headers()["content-disposition"]).toMatch(
      /attachment; filename="delivery-report.*\.csv"/,
    );

    const records = parseCsv(await res.text());
    const header = records[0];
    const dataRows = records.slice(1);

    // One CSV row per delivered page shown in the table.
    expect(dataRows.length, "CSV row count should equal the delivery table").toBe(rowCount);

    // The CSV's Issues column sums to the same total as the table.
    const issuesIdx = header.indexOf("Issues");
    expect(issuesIdx, "CSV should have an Issues column").toBeGreaterThanOrEqual(0);
    const csvIssues = dataRows.reduce((n, r) => n + (Number(r[issuesIdx]) || 0), 0);
    expect(csvIssues, "CSV Issues total should match the report").toBe(tableIssues);
  });
});
