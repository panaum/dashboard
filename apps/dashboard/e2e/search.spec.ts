import { test, expect, type Page } from "@playwright/test";

/**
 * Search — focuses on the case-insensitivity fix (Postgres LIKE is case-sensitive
 * by default, which silently regressed search after the SQLite→Supabase move).
 *
 * The query token is discovered from real data on the Clients page, so the test
 * isn't pinned to specific seed values.
 */

const resultCount = async (page: Page, q: string): Promise<number> => {
  await page.goto(`/dashboard/search?q=${encodeURIComponent(q)}`);
  // "12 results" / "1 result" / "100 results (showing first 100)" — take the
  // number that precedes "result(s)", not any trailing count.
  const txt = await page.getByText(/\d+\s+results?/).first().innerText();
  return Number(txt.match(/(\d+)\s+results?/)?.[1] ?? "0");
};

test.describe("search", () => {
  test("a text query returns matches and is case-insensitive", async ({ page }) => {
    // Discover a real client name to search for. Read the name span directly —
    // the card's innerText leads with the Avatar's initials, not the name.
    await page.goto("/dashboard/clients");
    const firstCard = page.locator('a[href^="/dashboard/clients/"]').first();
    await expect(firstCard).toBeVisible({ timeout: 30_000 });
    const name = (await firstCard.locator("span.font-medium").first().innerText()).trim();
    const token = name.match(/[A-Za-z]{3,}/)?.[0] ?? name;

    const lower = await resultCount(page, token.toLowerCase());
    const upper = await resultCount(page, token.toUpperCase());

    expect(upper, `searching "${token}" should return matches`).toBeGreaterThan(0);
    expect(lower, "lower- and upper-case queries should return the same count").toBe(upper);
  });
});
