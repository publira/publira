import { expect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";

import {
  createEpisodeViaUi,
  createSeriesViaUi,
  expectPeriodInputsAligned,
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

/** What every episode here sells for, in the seed tenant's yen. */
const EPISODE_PRICE = 500;

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

/** Fills the price and period fields of the form or dialog `scope` holds. */
const fillCampaign = async (scope: Locator, price: number) => {
  const period = scheduledPeriod();
  await scope
    .getByRole("spinbutton", { name: /Campaign price/u })
    .fill(String(price));
  await fillDateTime(
    scope.getByLabel("Starts", { exact: true }),
    period.startsAt
  );
  await fillDateTime(scope.getByLabel("Ends", { exact: true }), period.endsAt);
  await expectPeriodInputsAligned(scope);
};

/**
 * The campaign prices section of an episode screen. The page body is a
 * `<section>` too, so the innermost one holding the heading is the section.
 */
const campaignPricesSection = (page: Page): Locator =>
  page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: "Campaign prices" }) })
    .last();

/** Opens an episode screen and counts the campaign prices it lists. */
const expectCampaignPriceCount = async (
  page: Page,
  seriesId: string,
  episodeId: string,
  count: number
) => {
  await page.goto(adminUrl(`/series/${seriesId}/episodes/${episodeId}`));
  await expect(campaignPricesSection(page).getByRole("listitem")).toHaveCount(
    count
  );
};

/**
 * Campaign prices in the console: scheduled and removed on one episode, and
 * scheduled across the episodes checked on the series episode list.
 */
test.describe("admin campaign prices", () => {
  let createdSeriesIds: string[] = [];

  test.beforeEach(async ({ page }) => {
    createdSeriesIds = [];
    await signInAsSeedAdmin(page);
  });

  test.afterEach(() => {
    deleteSeriesByPublicIds(createdSeriesIds);
    createdSeriesIds = [];
  });

  test("schedules a campaign price on an episode and deletes it again", async ({
    page,
  }) => {
    const suffix = uniqueSuffix();
    const seriesId = await createSeriesViaUi(page, {
      publishedAt: publishedAtOneHourAgo(),
      synopsis: `Campaign price series ${suffix}`,
      title: `E2E Campaign Price ${suffix}`,
    });
    createdSeriesIds.push(seriesId);
    const episodeId = await createEpisodeViaUi(page, {
      price: EPISODE_PRICE,
      seriesPublicId: seriesId,
      title: `E2E Campaign Price Episode ${suffix}`,
    });

    await page.goto(adminUrl(`/series/${seriesId}/episodes/${episodeId}`));
    const section = campaignPricesSection(page);
    await expect(
      section.getByText("No campaign prices are scheduled for this episode.")
    ).toBeVisible();

    // A campaign that would not cut the price is refused, and nothing is
    // scheduled.
    await fillCampaign(section, EPISODE_PRICE);
    await section.getByRole("button", { name: "Add campaign price" }).click();
    await expect(
      section.getByText(
        "Campaign price must be lower than the episode's price."
      )
    ).toBeVisible();
    await expect(section.getByRole("listitem")).toHaveCount(0);

    await fillCampaign(section, 300);
    await section.getByRole("button", { name: "Add campaign price" }).click();

    await expect(page.getByText("Campaign price added.")).toBeVisible();
    const row = section.getByRole("listitem");
    await expect(row).toHaveCount(1);
    await expect(row.getByText(/300/u)).toBeVisible();
    await expect(row.getByText("Scheduled", { exact: true })).toBeVisible();

    await row.getByRole("button", { name: "Delete" }).click();
    // The confirmation carries the same label as the trigger that opened it,
    // so the dialog is what tells the two apart.
    await page
      .getByRole("alertdialog")
      .getByRole("button", { exact: true, name: "Delete" })
      .click();

    await expect(page.getByText("Campaign price deleted.")).toBeVisible();
    await expect(section.getByRole("listitem")).toHaveCount(0);
  });

  test("schedules one price and period on the episodes checked on the series list", async ({
    page,
  }) => {
    const suffix = uniqueSuffix();
    const seriesId = await createSeriesViaUi(page, {
      publishedAt: publishedAtOneHourAgo(),
      synopsis: `Campaign price sale ${suffix}`,
      title: `E2E Campaign Price Sale ${suffix}`,
    });
    createdSeriesIds.push(seriesId);
    // Created one after another: each lands at the end of the series, so the
    // order they are created in is the order the list shows.
    const first = await createEpisodeViaUi(page, {
      price: EPISODE_PRICE,
      seriesPublicId: seriesId,
      title: `E2E Sale One ${suffix}`,
    });
    const second = await createEpisodeViaUi(page, {
      price: EPISODE_PRICE,
      seriesPublicId: seriesId,
      title: `E2E Sale Two ${suffix}`,
    });
    const third = await createEpisodeViaUi(page, {
      price: EPISODE_PRICE,
      seriesPublicId: seriesId,
      title: `E2E Sale Three ${suffix}`,
    });

    await page.goto(adminUrl(`/series/${seriesId}/episodes`));
    await page
      .getByRole("checkbox", { name: `Select E2E Sale Two ${suffix}` })
      .check();
    await page
      .getByRole("checkbox", { name: `Select E2E Sale Three ${suffix}` })
      .check();
    await page
      .getByRole("button", { exact: true, name: "Campaign price" })
      .click();

    const dialog = page.getByRole("dialog", { name: "Add a campaign price" });
    await expect(
      dialog.getByText("2 episodes selected on the list.")
    ).toBeVisible();
    await fillCampaign(dialog, 300);
    await dialog.getByRole("button", { exact: true, name: "Add" }).click();

    await expect(
      page.getByText("Added a campaign price to 2 episodes.")
    ).toBeVisible();
    await expect(dialog).toBeHidden();

    // Each checked episode now lists the campaign, and the one left unchecked
    // does not.
    await expectCampaignPriceCount(page, seriesId, second, 1);
    await expectCampaignPriceCount(page, seriesId, third, 1);
    await expectCampaignPriceCount(page, seriesId, first, 0);
  });
});
