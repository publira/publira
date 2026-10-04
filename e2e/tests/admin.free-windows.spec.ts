import { expect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";

import {
  createEpisodeViaUi,
  createSeriesViaUi,
  signInAsSeedAdmin,
} from "../src/admin";
import { deleteSeriesByPublicIds } from "../src/db";
import {
  publishedAtOneHourAgo,
  toSeedTenantDateTimeLocal,
  uniqueSuffix,
} from "../src/scenarios/admin-publish";
import { WEB_ADMIN_BASE_URL } from "../src/urls";

const adminUrl = (pathname: string): string =>
  `${WEB_ADMIN_BASE_URL}${pathname}`;

/**
 * A period far enough ahead to stay scheduled for the whole test, so the
 * status the list shows does not depend on how long a slow CI run takes.
 */
const scheduledPeriod = () => {
  const startsAt = Temporal.Now.instant().add({ hours: 24 });
  return { endsAt: startsAt.add({ hours: 48 }), startsAt };
};

/**
 * Fills a `datetime-local` field until it holds the value. The field is
 * controlled, so a fill that lands before the page hydrates is reset by the
 * first render, and the form would post no instant for it.
 */
const fillDateTime = async (field: Locator, instant: Temporal.Instant) => {
  const value = toSeedTenantDateTimeLocal(instant);
  await expect(async () => {
    await field.fill(value);
    await expect(field).toHaveValue(value, { timeout: 1000 });
  }).toPass();
};

/** Fills the period fields of the form or dialog `scope` holds. */
const fillPeriod = async (
  scope: Locator | Page,
  period: ReturnType<typeof scheduledPeriod>
) => {
  await fillDateTime(
    scope.getByLabel("Starts", { exact: true }),
    period.startsAt
  );
  await fillDateTime(scope.getByLabel("Ends", { exact: true }), period.endsAt);
};

/**
 * The free reading periods section of an episode screen. The page body is a
 * `<section>` too, so the innermost one holding the heading is the section.
 */
const freeWindowsSection = (page: Page): Locator =>
  page
    .locator("section")
    .filter({
      has: page.getByRole("heading", { name: "Free reading periods" }),
    })
    .last();

/** Opens an episode screen and counts the free reading periods it lists. */
const expectFreeWindowCount = async (
  page: Page,
  seriesId: string,
  episodeId: string,
  count: number
) => {
  await page.goto(adminUrl(`/series/${seriesId}/episodes/${episodeId}`));
  await expect(freeWindowsSection(page).getByRole("listitem")).toHaveCount(
    count
  );
};

/**
 * Free reading periods in the console: scheduled and removed on one episode,
 * and scheduled across the episodes checked on the series episode list.
 */
test.describe("admin free reading periods", () => {
  let createdSeriesIds: string[] = [];

  test.beforeEach(async ({ page }) => {
    createdSeriesIds = [];
    await signInAsSeedAdmin(page);
  });

  test.afterEach(() => {
    deleteSeriesByPublicIds(createdSeriesIds);
    createdSeriesIds = [];
  });

  test("schedules a free reading period on an episode and deletes it again", async ({
    page,
  }) => {
    const suffix = uniqueSuffix();
    const seriesId = await createSeriesViaUi(page, {
      publishedAt: publishedAtOneHourAgo(),
      synopsis: `Free window series ${suffix}`,
      title: `E2E Free Window ${suffix}`,
    });
    createdSeriesIds.push(seriesId);
    const episodeId = await createEpisodeViaUi(page, {
      seriesPublicId: seriesId,
      title: `E2E Free Window Episode ${suffix}`,
    });

    await page.goto(adminUrl(`/series/${seriesId}/episodes/${episodeId}`));
    const section = freeWindowsSection(page);
    await expect(
      section.getByText(
        "No free reading periods are scheduled for this episode."
      )
    ).toBeVisible();

    await fillPeriod(section, scheduledPeriod());
    await section
      .getByRole("button", { name: "Add free reading period" })
      .click();

    await expect(page.getByText("Free reading period added.")).toBeVisible();
    const row = section.getByRole("listitem");
    await expect(row).toHaveCount(1);
    await expect(row.getByText("Scheduled", { exact: true })).toBeVisible();

    await row.getByRole("button", { name: "Delete" }).click();
    // The confirmation carries the same label as the trigger that opened it,
    // so the dialog is what tells the two apart.
    await page
      .getByRole("alertdialog")
      .getByRole("button", { exact: true, name: "Delete" })
      .click();

    await expect(page.getByText("Free reading period deleted.")).toBeVisible();
    await expect(section.getByRole("listitem")).toHaveCount(0);
    await expect(
      section.getByText(
        "No free reading periods are scheduled for this episode."
      )
    ).toBeVisible();
  });

  test("schedules one period on the episodes checked on the series list", async ({
    page,
  }) => {
    const suffix = uniqueSuffix();
    const seriesId = await createSeriesViaUi(page, {
      publishedAt: publishedAtOneHourAgo(),
      synopsis: `Free window campaign ${suffix}`,
      title: `E2E Free Window Campaign ${suffix}`,
    });
    createdSeriesIds.push(seriesId);
    // Created one after another: each lands at the end of the series, so the
    // order they are created in is the order the list shows.
    const first = await createEpisodeViaUi(page, {
      seriesPublicId: seriesId,
      title: `E2E Campaign One ${suffix}`,
    });
    const second = await createEpisodeViaUi(page, {
      seriesPublicId: seriesId,
      title: `E2E Campaign Two ${suffix}`,
    });
    const third = await createEpisodeViaUi(page, {
      seriesPublicId: seriesId,
      title: `E2E Campaign Three ${suffix}`,
    });

    await page.goto(adminUrl(`/series/${seriesId}/episodes`));
    await page
      .getByRole("checkbox", { name: `Select E2E Campaign Two ${suffix}` })
      .check();
    await page
      .getByRole("checkbox", { name: `Select E2E Campaign Three ${suffix}` })
      .check();
    await page
      .getByRole("button", { exact: true, name: "Free reading period" })
      .click();

    const dialog = page.getByRole("dialog", {
      name: "Add a free reading period",
    });
    await expect(
      dialog.getByRole("radio", { checked: true, name: "Selected episodes" })
    ).toBeVisible();
    await fillPeriod(dialog, scheduledPeriod());
    await dialog.getByRole("button", { exact: true, name: "Add" }).click();

    await expect(
      page.getByText("Added a free reading period to 2 episodes.")
    ).toBeVisible();
    await expect(dialog).toBeHidden();

    // Each checked episode now lists the period, and the one left unchecked
    // does not.
    await expectFreeWindowCount(page, seriesId, second, 1);
    await expectFreeWindowCount(page, seriesId, third, 1);
    await expectFreeWindowCount(page, seriesId, first, 0);
  });
});
