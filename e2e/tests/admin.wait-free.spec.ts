import { expect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";

import { createSeriesViaUi, signInAsSeedAdmin } from "../src/admin";
import { deleteSeriesByPublicIds } from "../src/db";
import {
  publishedAtOneHourAgo,
  uniqueSuffix,
} from "../src/scenarios/admin-publish";
import { WEB_ADMIN_BASE_URL } from "../src/urls";

const adminUrl = (pathname: string): string =>
  `${WEB_ADMIN_BASE_URL}${pathname}`;

/**
 * The free-if-you-wait section of a series screen. The page body is a
 * `<section>` too, so the innermost one holding the heading is the section.
 */
const waitFreeSection = (page: Page): Locator =>
  page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: "Free if you wait" }) })
    .last();

const waitFreeFields = (section: Locator) => ({
  accessHours: section.getByRole("spinbutton", {
    name: "Hours an episode stays open",
  }),
  enabled: section.getByRole("switch", {
    name: "Offer free tickets on this series",
  }),
  excludedLatestCount: section.getByRole("spinbutton", {
    name: "Newest episodes a ticket cannot open",
  }),
  rechargeHours: section.getByRole("spinbutton", {
    name: "Hours until the next ticket",
  }),
});

/**
 * Wait-for-free in the console: a series opens on the API's defaults, and a
 * saved rule is what the screen and the audit log show afterwards.
 */
test.describe("admin wait-for-free settings", () => {
  let createdSeriesIds: string[] = [];

  test.beforeEach(async ({ page }) => {
    createdSeriesIds = [];
    await signInAsSeedAdmin(page);
  });

  test.afterEach(() => {
    deleteSeriesByPublicIds(createdSeriesIds);
    createdSeriesIds = [];
  });

  test("saves a series' rule and records the change", async ({ page }) => {
    const suffix = uniqueSuffix();
    const seriesId = await createSeriesViaUi(page, {
      publishedAt: publishedAtOneHourAgo(),
      synopsis: `Wait-for-free series ${suffix}`,
      title: `E2E Wait Free ${suffix}`,
    });
    createdSeriesIds.push(seriesId);

    await page.goto(adminUrl(`/series/${seriesId}`));
    const fields = waitFreeFields(waitFreeSection(page));

    // A series nobody configured answers the API's defaults.
    await expect(fields.enabled).not.toBeChecked();
    await expect(fields.rechargeHours).toHaveValue("23");
    await expect(fields.accessHours).toHaveValue("72");
    await expect(fields.excludedLatestCount).toHaveValue("0");

    // A click that lands before the switch hydrates does nothing, and
    // `check()` is a no-op once it holds.
    await expect(async () => {
      await fields.enabled.check({ timeout: 1000 });
    }).toPass();
    await fields.rechargeHours.fill("12");
    await fields.accessHours.fill("48");
    await fields.excludedLatestCount.fill("2");
    await waitFreeSection(page)
      .getByRole("button", { name: "Save free-if-you-wait settings" })
      .click();

    await expect(
      page.getByText("Free-if-you-wait settings saved.")
    ).toBeVisible();

    // Read back from the API rather than from what the form still held.
    await page.reload();
    const saved = waitFreeFields(waitFreeSection(page));
    await expect(saved.enabled).toBeChecked();
    await expect(saved.rechargeHours).toHaveValue("12");
    await expect(saved.accessHours).toHaveValue("48");
    await expect(saved.excludedLatestCount).toHaveValue("2");

    await page.goto(
      adminUrl("/audit-logs?action=series_wait_free_settings_updated")
    );
    await expect(
      page
        .getByRole("row")
        .filter({ hasText: `Series / ${seriesId}` })
        .filter({ hasText: "Free-if-you-wait settings updated" })
    ).toHaveCount(1);
  });
});
