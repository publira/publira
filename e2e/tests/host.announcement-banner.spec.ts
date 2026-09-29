import type { Browser, Locator, Page } from "@playwright/test";
import { expect, test } from "@playwright/test";

import { fillField, signInAsAnnouncementBannerAdmin } from "../src/admin";
import { applyScenarioSql } from "../src/db";
import { ANNOUNCEMENT_BANNER_SCENARIO } from "../src/scenarios/announcement-banner";
import {
  hostPath,
  WEB_ADMIN_ANNOUNCEMENT_BANNER_BASE_URL,
  WEB_HOST_ANNOUNCEMENT_BANNER_BASE_URL,
} from "../src/urls";

const bannerHostUrl = (pathname: string): string =>
  `${WEB_HOST_ANNOUNCEMENT_BANNER_BASE_URL}${hostPath(pathname)}`;

const bannerAdminUrl = (pathname: string): string =>
  `${WEB_ADMIN_ANNOUNCEMENT_BANNER_BASE_URL}${pathname}`;

const PINNED_TITLE = "Maintenance window tonight";
const ORDINARY_TITLE = "A new series has arrived";

/** The band the site draws above the header, and nothing else on the page. */
const banner = (page: Page): Locator => page.getByRole("complementary");

/** Post one announcement from the console, pinned or not. */
const postAnnouncement = async (
  page: Page,
  fields: { body: string; pinned: boolean; title: string }
): Promise<void> => {
  await page.goto(bannerAdminUrl("/announcements/new"));
  await expect(
    page.getByRole("heading", { name: "Create an announcement" })
  ).toBeVisible();

  await fillField(page.getByRole("textbox", { name: /Title/u }), fields.title);
  await fillField(page.getByRole("textbox", { name: /Body/u }), fields.body);
  if (fields.pinned) {
    await page.getByRole("checkbox", { name: "Show as a site banner" }).check();
  }

  await page.getByRole("button", { name: "Deliver the announcement" }).click();
  await expect(page).toHaveURL(/\/announcements\/?$/u);
  await expect(
    page.getByRole("cell", { exact: true, name: fields.title })
  ).toBeVisible();
};

/**
 * Open the tenant's storefront in a browser that has never seen it, and wait
 * until the band matches what the console was just told.
 *
 * The banner is a cached read the console's write drops the tag of, so the
 * first navigation after a write can still be served the previous answer. This
 * retries the navigation rather than sleeping, the way the announcement
 * delivery spec waits for the member list.
 */
const openSiteUntil = async (
  browser: Browser,
  expectBanner: (page: Page) => Promise<void>
): Promise<Page> => {
  const context = await browser.newContext();
  const page = await context.newPage();

  await expect(async () => {
    await page.goto(bannerHostUrl("/"));
    await expectBanner(page);
  }).toPass({ timeout: 30_000 });

  return page;
};

/**
 * A pinned announcement as a reader meets it: above every page, dismissible per
 * browser, and still in the list once the band is gone.
 *
 * The suite pins in a tenant of its own (`200_announcement_banner.sql`), because
 * a banner is drawn over every page of the site it belongs to and would
 * otherwise stand above whatever another spec was looking at.
 */
test.describe("web-host pinned announcement banner", () => {
  // One tenant, one banner: each test leaves the site in the state the next one
  // starts from.
  test.describe.configure({ mode: "serial" });

  test.beforeAll(() => {
    applyScenarioSql(ANNOUNCEMENT_BANNER_SCENARIO);
  });

  test("a pinned announcement reaches a visitor who never signed in, and stays dismissed once closed", async ({
    browser,
    page,
  }) => {
    await signInAsAnnouncementBannerAdmin(page);
    await postAnnouncement(page, {
      body: "The site will be unavailable between 01:00 and 02:00.",
      pinned: true,
      title: PINNED_TITLE,
    });

    const site = await openSiteUntil(browser, async (visitor) => {
      await expect(banner(visitor)).toContainText(PINNED_TITLE, {
        timeout: 5000,
      });
    });

    await site.getByRole("button", { name: "Close this announcement" }).click();
    await expect(banner(site)).toBeHidden();

    // The band is gone on the next page too, which is what "dismissed" has to
    // mean for something drawn above every one of them.
    await site.goto(bannerHostUrl("/series"));
    await expect(banner(site)).toBeHidden();

    // Closing the band is not reading the announcement: the row is still there.
    await site.goto(bannerHostUrl("/announcements"));
    await expect(
      site.getByRole("heading", { level: 3, name: PINNED_TITLE })
    ).toBeVisible();

    await site.context().close();
  });

  test("taking the banner down from the console stops showing it", async ({
    browser,
    page,
  }) => {
    await signInAsAnnouncementBannerAdmin(page);
    await page
      .getByRole("row", { name: new RegExp(PINNED_TITLE, "u") })
      .getByRole("button", { name: "Stop showing" })
      .click();
    await expect(
      page
        .getByRole("row", { name: new RegExp(PINNED_TITLE, "u") })
        .getByRole("button", { name: "Stop showing" })
    ).toBeHidden();

    const site = await openSiteUntil(browser, async (visitor) => {
      await expect(banner(visitor)).toBeHidden({ timeout: 5000 });
    });

    // The announcement outlives its banner.
    await site.goto(bannerHostUrl("/announcements"));
    await expect(
      site.getByRole("heading", { level: 3, name: PINNED_TITLE })
    ).toBeVisible();

    await site.context().close();
  });

  test("an ordinary announcement changes nothing outside the list", async ({
    browser,
    page,
  }) => {
    await signInAsAnnouncementBannerAdmin(page);
    await postAnnouncement(page, {
      body: "Read the first episode today.",
      pinned: false,
      title: ORDINARY_TITLE,
    });

    const site = await openSiteUntil(browser, async (visitor) => {
      await expect(banner(visitor)).toBeHidden({ timeout: 5000 });
    });

    await site.goto(bannerHostUrl("/announcements"));
    await expect(
      site.getByRole("heading", { level: 3, name: ORDINARY_TITLE })
    ).toBeVisible();

    await site.context().close();
  });
});
