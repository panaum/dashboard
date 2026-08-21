import { test, expect, type Page } from "@playwright/test";

/**
 * Team performance panel on the Search page — cross-checks against the panel's
 * own data rather than pinned numbers, so it survives re-imports.
 */

const panel = (page: Page) =>
  page.getByRole("region", { name: "Team performance" });

/** A headline stat tile's value ("Pages" → 71). Scoped to the tile row, since
 *  "Pages" is also a chart tab and a table column inside the panel. */
const stat = async (page: Page, label: string): Promise<string> => {
  const value = page
    .getByRole("group", { name: "Headline numbers" })
    .getByText(label, { exact: true })
    .locator("xpath=following-sibling::div[1]");
  return (await value.innerText()).trim();
};

const statNumber = async (page: Page, label: string): Promise<number> =>
  Number((await stat(page, label)).replace(/[^\d.]/g, ""));

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
    await page.goto("/dashboard/insights");
    await expect(panel(page)).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("Pick a filter to begin")).toHaveCount(0);
    expect((await tableRows(page)).length).toBeGreaterThan(0);
  });

  test("per-developer rows agree with the headline numbers", async ({ page }) => {
    await page.goto("/dashboard/insights");
    await expect(panel(page)).toBeVisible({ timeout: 30_000 });

    const rows = await tableRows(page);
    const assigned = rows.reduce((n, r) => n + Number(r[1]), 0);
    // Pages with no developer count for nobody, so the table sums to at most
    // the headline — never past it.
    expect(assigned).toBeGreaterThan(0);
    expect(assigned).toBeLessThanOrEqual(await statNumber(page, "Pages"));

    // On-time % is a share of that developer's own pages, so it is bounded.
    for (const r of rows) {
      const pct = Number(r[5].replace(/\D/g, ""));
      expect(pct).toBeGreaterThanOrEqual(0);
      expect(pct).toBeLessThanOrEqual(100);
    }
  });

  test("filtering to one developer makes both reducers agree", async ({
    page,
  }) => {
    // The headline tiles come from computeInsights and the table from
    // computeTeamPerformance. Narrowed to a single developer they describe the
    // same pages, so their numbers have to line up.
    await page.goto("/dashboard/insights");
    await expect(panel(page)).toBeVisible({ timeout: 30_000 });

    const row = (await tableRows(page)).find((r) => Number(r[1]) >= 3)!;
    expect(row, "need a developer with a few pages to compare").toBeTruthy();
    const id = await page
      .locator('select[name="developerId"] option')
      .filter({ hasText: new RegExp(`^${row[0]}$`) })
      .first()
      .getAttribute("value");

    await page.goto(`/dashboard/insights?developerId=${id}`);
    await expect(panel(page)).toBeVisible({ timeout: 30_000 });

    expect(await statNumber(page, "Pages"), "pages for that developer").toBe(
      Number(row[1]),
    );
    expect(
      await statNumber(page, "Avg issues / page"),
      "defect rate for that developer",
    ).toBeCloseTo(Number(row[3]), 1);
  });

  test("the metric toggle re-sorts the same chart", async ({ page }) => {
    await page.goto("/dashboard/insights");
    await expect(panel(page)).toBeVisible({ timeout: 30_000 });

    await panel(page).getByRole("tab", { name: "Issues done" }).click();
    await expect(page.getByText("Most issues done first")).toBeVisible();

    await panel(page).getByRole("tab", { name: "On-time %" }).click();
    await expect(page.getByText("Lowest on-time rate first")).toBeVisible();
  });

  test("table columns sort, and re-sort in reverse on a second click", async ({
    page,
  }) => {
    await page.goto("/dashboard/insights");
    await expect(panel(page)).toBeVisible({ timeout: 30_000 });

    // Which column is active by default depends on the data (on-time leads
    // once any delay is recorded), so assert the toggle, not a fixed default.
    const header = panel(page).getByRole("columnheader", { name: /^Pages/ });

    await header.getByRole("button").click();
    await expect(header).toHaveAttribute("aria-sort", /ascending|descending/);
    const firstDir = await header.getAttribute("aria-sort");
    const first = (await tableRows(page)).map((r) => Number(r[1]));
    expect(first).toEqual(
      [...first].sort((a, b) => (firstDir === "ascending" ? a - b : b - a)),
    );

    await header.getByRole("button").click();
    const secondDir =
      firstDir === "ascending" ? "descending" : "ascending";
    await expect(header).toHaveAttribute("aria-sort", secondDir);
    const second = (await tableRows(page)).map((r) => Number(r[1]));
    expect(second).toEqual(
      [...second].sort((a, b) => (secondDir === "ascending" ? a - b : b - a)),
    );
  });

  test("the panel follows the page filters and keeps the whole team in view", async ({
    page,
  }) => {
    await page.goto("/dashboard/insights");
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
    await page.goto(`/dashboard/insights?developerId=${id}`);
    await expect(panel(page)).toBeVisible({ timeout: 30_000 });
    await expect(panel(page).getByText(/is highlighted below/)).toBeVisible();
    const highlighted = await tableRows(page);
    expect(highlighted.length, "the whole team stays in view").toBe(everyone);
    expect(highlighted.some((r) => r[0] === name)).toBe(true);

    // A status filter recomputes the panel, not just the results below it.
    await page.goto("/dashboard/insights?status=IN_PROGRESS");
    await expect(panel(page)).toBeVisible({ timeout: 30_000 });
    const narrowed = await statNumber(page, "Pages");
    await page.goto("/dashboard/insights");
    expect(narrowed).toBeLessThanOrEqual(await statNumber(page, "Pages"));
  });

  test("all-time scope widens the rolling window and the search below still works", async ({
    page,
  }) => {
    await page.goto("/dashboard/insights");
    await expect(panel(page)).toBeVisible({ timeout: 30_000 });
    const rolling = await statNumber(page, "Pages");

    await page.getByRole("link", { name: "All time" }).click();
    await expect(page.getByText("All time", { exact: true })).toBeVisible();
    expect(await statNumber(page, "Pages")).toBeGreaterThanOrEqual(
      rolling,
    );

    // The existing search is untouched by the panel.
    await page.locator('select[name="status"]').selectOption("LIVE");
    await page.getByRole("button", { name: "Apply", exact: true }).click();
    await expect(page.getByText(/\d+\s+results?/).first()).toBeVisible({
      timeout: 30_000,
    });
  });
});
