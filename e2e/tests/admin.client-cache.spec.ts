import { instant } from "@next/playwright";
import { expect, test } from "@playwright/test";

import { signInAsSeedAdmin } from "../src/admin";
import { SEED_ADMIN } from "../src/scenarios/admin-publish";

/**
 * Moving between console screens keeps the operator's chrome. The session read
 * keeps no stale time of its own, so a signed-in route stays in the client
 * cache for as long as the reads that hold its data allow, and a navigation
 * commits the sidebar and the account menu at once while the destination's own
 * reads are still on their way.
 *
 * `instant()` holds back everything the navigation would wait on the server
 * for. The source screen is left to finish first: a click while the dashboard
 * is still streaming lands before the router holds the chrome it would reuse.
 */
test.describe("web-admin client cache", () => {
  test("a navigation commits the session chrome before the page's reads", async ({
    page,
  }) => {
    const accountMenu = page.getByRole("button", {
      name: `Account menu for ${SEED_ADMIN.name}`,
    });
    const seriesTable = page.getByRole("columnheader", {
      exact: true,
      name: "Title",
    });

    await signInAsSeedAdmin(page, "/");
    await expect(accountMenu).toBeVisible();
    await expect(
      page.getByRole("heading", { level: 2, name: "Publishing queue" })
    ).toBeVisible();

    await instant(page, async () => {
      await page.getByRole("link", { exact: true, name: "Series" }).click();
      await expect(page).toHaveURL(/\/series$/u);
      await expect(accountMenu).toBeVisible();
      await expect(
        page.getByRole("link", { exact: true, name: "Dashboard" })
      ).toBeVisible();
      // The list is the page's own read, so it waits for the release.
      await expect(seriesTable).toHaveCount(0);
    });

    await expect(seriesTable).toBeVisible();
  });
});
