import { test, expect, type Page } from "@playwright/test";

/**
 * Team performance panel on the Search page — cross-checks against the panel's
 * own data rather than pinned numbers, so it survives re-imports.
 */

const panel = (page: Page) =>
  page.getByRole("region", { name: "Team performance" });

/** A headline stat tile's value ("Pages delivered" → 71). */
const stat = async (page: Page, label: string): Promise<number> => {
  const value = panel(page)
    .getByText(label, { exact: true })
    .locator("xpath=following-sibling::div[1]");
  return Number((await value.innerText()).replace(/\D/g, ""));
};

/** Every row of the sortable table as [name, pages, issuesDone, delay, onTime]. */
const tableRows = async (page: Page): Promise<string[][]> => {
  const table = panel(page).getByRole("table");
  await expect(table.getByRole("row").nth(1)).toBeVisible({ timeout: 30_000 });
  const rows = await table.getByRole("row").all();
  const out: string[][] = [];
  for (const row of rows) {
    const cells = await row.getByRole("cell").all();
    if (cells.length === 0) continue; // header row
    // The name cell leads with the Avatar's initials ("AT\nAtul"), so keep the
    // last line of each cell.
    out.push(
      await Promise.all(
        cells.map(async (c) =>
          (await c.innerText()).trim().split("\n").pop()!.trim(),
        ),
      ),
    );
  }
  return out;
};

test.describe("team performance", () => {
  test("shows the panel with no filters applied, instead of an empty state", async ({
    page,
  }) => {
    await page.goto("/dashboard/search");
    await expect(panel(page)).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("Pick a filter to begin")).toHaveCount(0);
    expect((await tableRows(page)).length).toBeGreaterThan(0);
  });

  test("per-developer rows add up to the headline totals", async ({ page }) => {
    await page.goto("/dashboard/search");
    await expect(panel(page)).toBeVisible({ timeout: 30_000 });

    const rows = await tableRows(page);
    const sum = (i: number) =>
      rows.reduce((n, r) => n + Number(r[i].replace(/\D/g, "") || 0), 0);

    expect(sum(1), "pages per developer should sum to the headline").toBe(
      await stat(page, "Pages delivered"),
    );
    expect(sum(2), "issues done per developer should sum to the headline").toBe(
      await stat(page, "Issues fixed"),
    );

    // On-time % is a share of that developer's own pages, so it is bounded.
    for (const r of rows) {
      const pct = Number(r[4].replace(/\D/g, ""));
      expect(pct).toBeGreaterThanOrEqual(0);
      expect(pct).toBeLessThanOrEqual(100);
    }
  });

  test("the metric toggle re-sorts the same chart", async ({ page }) => {
    await page.goto("/dashboard/search");
    await expect(panel(page)).toBeVisible({ timeout: 30_000 });

    await panel(page).getByRole("tab", { name: "Issues done" }).click();
    await expect(page.getByText("Most issues done first")).toBeVisible();

    await panel(page).getByRole("tab", { name: "On-time %" }).click();
    await expect(page.getByText("Lowest on-time rate first")).toBeVisible();
  });

  test("table columns sort, and re-sort in reverse on a second click", async ({
    page,
  }) => {
    await page.goto("/dashboard/search");
    await expect(panel(page)).toBeVisible({ timeout: 30_000 });

    const header = panel(page).getByRole("columnheader", { name: /Pages/ });
    await header.getByRole("button").click();
    const first = (await tableRows(page)).map((r) => Number(r[1]));
    expect(first).toEqual([...first].sort((a, b) => a - b));

    await header.getByRole("button").click();
    const second = (await tableRows(page)).map((r) => Number(r[1]));
    expect(second).toEqual([...second].sort((a, b) => b - a));
  });

  test("the panel follows the page filters and keeps the whole team in view", async ({
    page,
  }) => {
    await page.goto("/dashboard/search");
    await expect(panel(page)).toBeVisible({ timeout: 30_000 });
    const everyone = (await tableRows(page)).length;

    // Narrowing to one developer highlights them without hiding the rest.
    // Pick someone the panel actually lists in the default window.
    const name = (await tableRows(page))[0][0];
    const id = await page
      .locator('select[name="developerId"] option')
      .filter({ hasText: new RegExp(`^${name}$`) })
      .first()
      .getAttribute("value");
    await page.goto(`/dashboard/search?developerId=${id}`);
    await expect(panel(page)).toBeVisible({ timeout: 30_000 });
    await expect(panel(page).getByText(/is highlighted below/)).toBeVisible();
    const highlighted = await tableRows(page);
    expect(highlighted.length, "the whole team stays in view").toBe(everyone);
    expect(highlighted.some((r) => r[0] === name)).toBe(true);

    // A status filter recomputes the panel, not just the results below it.
    await page.goto("/dashboard/search?status=IN_PROGRESS");
    await expect(panel(page)).toBeVisible({ timeout: 30_000 });
    const narrowed = await stat(page, "Pages delivered");
    await page.goto("/dashboard/search");
    expect(narrowed).toBeLessThanOrEqual(await stat(page, "Pages delivered"));
  });

  test("all-time scope widens the rolling window and the search below still works", async ({
    page,
  }) => {
    await page.goto("/dashboard/search");
    await expect(panel(page)).toBeVisible({ timeout: 30_000 });
    const rolling = await stat(page, "Pages delivered");

    await panel(page).getByRole("link", { name: "All time" }).click();
    await expect(panel(page).getByText("All time")).toBeVisible();
    expect(await stat(page, "Pages delivered")).toBeGreaterThanOrEqual(
      rolling,
    );

    // The existing search is untouched by the panel.
    await page.locator('select[name="status"]').selectOption("LIVE");
    await page.getByRole("button", { name: "Search", exact: true }).click();
    await expect(page.getByText(/\d+\s+results?/).first()).toBeVisible({
      timeout: 30_000,
    });
  });
});
