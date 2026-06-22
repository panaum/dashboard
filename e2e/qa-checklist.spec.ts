import { test, expect, type Page } from "@playwright/test";

/**
 * Page-detail QA workflow — checklist editor.
 *
 * Detects the first check's current result, changes it in a known direction,
 * asserts the QA-progress count moves accordingly, then restores the exact
 * original value in a finally — net-zero on the real page regardless of how the
 * page was already graded.
 */

const readPassed = async (page: Page): Promise<number> => {
  const txt = await page.getByText(/\d+ passed · \d+ failed · \d+ checks/).innerText();
  return Number(txt.match(/(\d+) passed/)![1]);
};

test.describe("qa checklist (write)", () => {
  test("grading a check updates QA progress, then restores it", async ({ page }) => {
    // Find a page that actually has a QA checklist.
    await page.goto("/dashboard/search?q=a");
    const hrefs = [
      ...new Set(
        (
          await page
            .locator('a[href^="/dashboard/clients/"]')
            .evaluateAll((els) => els.map((e) => e.getAttribute("href")))
        ).filter((h): h is string => !!h),
      ),
    ].slice(0, 8);

    let found = false;
    for (const href of hrefs) {
      await page.goto(href);
      await expect(page.getByRole("heading", { name: "Issues" })).toBeVisible({
        timeout: 30_000,
      });
      if (await page.getByText("QA progress").isVisible().catch(() => false)) {
        found = true;
        break;
      }
    }
    test.skip(!found, "no page with a QA checklist found among results");

    // The first check's segmented control (the active option carries the sliding pill).
    const seg = page
      .getByRole("button", { name: "N/A", exact: true })
      .first()
      .locator('xpath=ancestor::div[contains(@class,"bg-card-soft")][1]');
    const activeBtn = seg.locator("button:has(span.shadow-xs)");
    await expect(activeBtn).toHaveCount(1);

    const original = (await activeBtn.innerText()).trim();
    const before = await readPassed(page);
    const clickSeg = (name: string) =>
      seg.getByRole("button", { name, exact: true }).click();

    try {
      if (original === "Passed") {
        // Already passed → move to Failed, expect one fewer passed.
        await clickSeg("Failed");
        await expect
          .poll(() => readPassed(page), { message: "passed should decrement" })
          .toBe(before - 1);
      } else {
        // Not passed → grade Passed, expect one more passed.
        await clickSeg("Passed");
        await expect
          .poll(() => readPassed(page), { message: "passed should increment" })
          .toBe(before + 1);
      }
    } finally {
      // Always restore the original grade so the real page is left untouched.
      await clickSeg(original);
    }

    await expect
      .poll(() => readPassed(page), { message: "passed should return to original" })
      .toBe(before);
  });
});
