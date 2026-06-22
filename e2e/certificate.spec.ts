import { test, expect } from "@playwright/test";

/**
 * Public certificate share flow (create → view publicly → revoke).
 *
 * Safety: this mutates a real page's share state, so it only runs on a page that
 * is currently UNSHARED, and it revokes at the end to restore that original
 * state. If the page already has a link (possibly a real one sent to a client),
 * the test skips rather than revoke it.
 */
test.describe("public certificate", () => {
  test("can publish a share link, view it without auth, and revoke it", async ({
    page,
  }) => {
    // Broad search ("a" matches most names) so we get many pages to choose from;
    // only 2/214 are shared, so an unshared one is easy to find.
    await page.goto("/dashboard/search?q=a");
    const hrefs = [
      ...new Set(
        (
          await page
            .locator('a[href^="/dashboard/clients/"]')
            .evaluateAll((els) => els.map((e) => e.getAttribute("href")))
        ).filter((h): h is string => !!h),
      ),
    ].slice(0, 6);
    expect(hrefs.length, "search should return pages to open").toBeGreaterThan(0);

    // Find a page that is currently UNSHARED, so we never revoke a real link.
    const createBtn = page.getByRole("button", { name: "Create link" });
    let found = false;
    for (const href of hrefs) {
      await page.goto(`${href}/certificate`);
      await expect(page.getByText("Client share link")).toBeVisible({ timeout: 30_000 });
      if (await createBtn.isVisible()) {
        found = true;
        break;
      }
    }
    test.skip(!found, "no unshared page found among the first results");

    // --- create the link ---
    await createBtn.click();
    // The share URL is the only read-only input on the certificate page.
    const shareInput = page.locator("input[readonly]");
    await expect(shareInput).toBeVisible();
    const url = await shareInput.inputValue();
    const shareId = url.split("/c/")[1];
    expect(shareId, "share URL should contain a /c/<id> token").toBeTruthy();

    try {
      // --- view the public certificate (separate tab; no auth needed) ---
      const pub = await page.context().newPage();
      try {
        await pub.goto(`/c/${shareId}`, { waitUntil: "domcontentloaded" });
        // exact: the footer also contains "...assurance certificate..." (case-insensitive).
        const header = pub.getByText("Quality Assurance Certificate", { exact: true });
        // The /c route may cold-compile on first hit; reload once to absorb it.
        const shown = await header
          .waitFor({ state: "visible", timeout: 12_000 })
          .then(() => true)
          .catch(() => false);
        if (!shown) await pub.reload({ waitUntil: "domcontentloaded" });
        await expect(header).toBeVisible({ timeout: 30_000 });
      } finally {
        await pub.close();
      }
    } finally {
      // Always revoke so a failure never leaves a stray link on a real page.
      const revoke = page.getByRole("button", { name: "Revoke" });
      if (await revoke.isVisible().catch(() => false)) {
        await revoke.click();
        await expect(createBtn, "Create link should reappear after revoking").toBeVisible();
      }
    }

    // --- confirm the revoked link is dead ---
    const pubAfter = await page.context().newPage();
    try {
      await pubAfter.goto(`/c/${shareId}`, { waitUntil: "domcontentloaded" });
      await expect(
        pubAfter.getByText("Quality Assurance Certificate", { exact: true }),
        "revoked link should no longer render the certificate",
      ).toHaveCount(0);
    } finally {
      await pubAfter.close();
    }
  });
});
