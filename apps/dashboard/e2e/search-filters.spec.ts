import { test, expect, type Page } from "@playwright/test";

/**
 * Search filters — correctness via cross-checks, not magic numbers.
 */

const resultCount = async (page: Page): Promise<number> => {
  const txt = await page.getByText(/\d+\s+results?/).first().innerText();
  return Number(txt.match(/(\d+)\s+results?/)?.[1] ?? "0");
};

/** Open the first team member and return their id + a stat-tile value. */
const firstMemberStat = async (page: Page, tile: string) => {
  await page.goto("/dashboard/team");
  const member = page.locator('a[href^="/dashboard/team/"]').first();
  await expect(member).toBeVisible({ timeout: 30_000 });
  await member.click();
  await expect(page).toHaveURL(/\/dashboard\/team\/[^/]+$/);
  const id = page.url().split("/").pop()!;
  const value = Number(
    (
      await page.getByText(tile, { exact: true }).locator("xpath=following-sibling::div[1]").innerText()
    ).replace(/\D/g, ""),
  );
  return { id, value };
};

/** Minimal RFC-4180 parser (quotes, doubled quotes, commas/newlines, CRLF, BOM). */
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

  test("tester filter returns exactly that tester's QA'd pages", async ({ page }) => {
    const { id, value: qad } = await firstMemberStat(page, "Pages QA'd");
    test.skip(qad > 100, "tester has more QA'd pages than the result cap");

    await page.goto(`/dashboard/search?testerId=${id}`);
    expect(await resultCount(page)).toBe(qad);
  });

  test("CSV export matches the filtered results", async ({ page }) => {
    const { id, value: built } = await firstMemberStat(page, "Pages built");
    test.skip(built === 0 || built > 100, "need a developer with 1..100 built pages");

    await page.goto(`/dashboard/search?developerId=${id}`);
    const count = await resultCount(page);

    const href = await page
      .getByRole("link", { name: /Export CSV/ })
      .getAttribute("href");
    expect(href, "export link should be present").toBeTruthy();

    const res = await page.request.get(href!);
    expect(res.status()).toBe(200);
    const dataRows = parseCsv(await res.text()).slice(1); // drop header
    expect(dataRows.length, "CSV rows should match the on-screen result count").toBe(count);
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
