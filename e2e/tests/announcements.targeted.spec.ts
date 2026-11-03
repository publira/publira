import type { Locator, Page } from "@playwright/test";
import { expect, test } from "@playwright/test";

import { applyScenarioSql } from "../src/db";
import {
  TARGETED_ANNOUNCEMENTS,
  TARGETED_ANNOUNCEMENTS_OTHER_READER,
  TARGETED_ANNOUNCEMENTS_READER,
  TARGETED_ANNOUNCEMENTS_SCENARIO,
} from "../src/scenarios/targeted-announcements";
import { signInAsMember, signOutStorefront } from "../src/storefront";
import {
  storefrontPath,
  WEB_STOREFRONT_TARGETED_ANNOUNCEMENTS_BASE_URL,
} from "../src/urls";

const targetedStorefrontUrl = (pathname: string): string =>
  `${WEB_STOREFRONT_TARGETED_ANNOUNCEMENTS_BASE_URL}${storefrontPath(pathname)}`;

const { newer, older, targeted } = TARGETED_ANNOUNCEMENTS;

const listedTitles = (page: Page): Locator => page.locator("article h3");

const announcementArticle = (page: Page, title: string): Locator =>
  page.locator("article").filter({
    has: page.getByRole("heading", { exact: true, level: 3, name: title }),
  });

const expectNotFound = async (page: Page): Promise<void> => {
  await expect(
    page.getByRole("heading", { level: 1, name: "Page not found" })
  ).toBeVisible();
  await expect(page.getByText(targeted.body)).toHaveCount(0);
};

/**
 * A targeted announcement on the storefront: listed among the public ones and
 * opened by the reader it was delivered to, and neither listed nor opened for
 * a visitor or for a reader it was not delivered to. The scenario writes the
 * announcement as delivered, with the notification the reader holds, so what
 * is under test is the site reading what the API answers each of them.
 */
test.describe("web-storefront targeted announcements", () => {
  test.beforeAll(() => {
    applyScenarioSql(TARGETED_ANNOUNCEMENTS_SCENARIO);
  });

  test("the reader it was sent to finds it between the public ones, opens it, and marks it read", async ({
    page,
  }) => {
    await signInAsMember(
      page,
      TARGETED_ANNOUNCEMENTS_READER,
      "/announcements",
      WEB_STOREFRONT_TARGETED_ANNOUNCEMENTS_BASE_URL
    );
    await expect(page).toHaveURL(/\/announcements\/?$/u);
    await expect(listedTitles(page)).toHaveText([
      newer.title,
      targeted.title,
      older.title,
    ]);

    await announcementArticle(page, targeted.title)
      .getByRole("link", { name: targeted.title })
      .click();
    await expect(page).toHaveURL(
      new RegExp(`/announcements/${targeted.id}$`, "u")
    );

    // Scoped to the page's own article: the list's rows can still be mounted
    // for the moment the client navigation replaces them.
    const opened = page.locator("article").filter({
      has: page.getByRole("heading", { level: 1, name: targeted.title }),
    });

    await expect(opened.getByText(targeted.body)).toBeVisible();

    await page.getByRole("link", { name: "All announcements" }).click();
    await expect(page).toHaveURL(/\/announcements\/?$/u);

    const row = announcementArticle(page, targeted.title);
    await expect(row.getByText("Unread", { exact: true })).toBeVisible();
    await row.getByRole("button", { name: "Mark as read" }).click();
    await expect(row.getByText("Read", { exact: true })).toBeVisible();
  });

  test("signed out, the list shows the public ones only and the announcement's page is not found", async ({
    page,
  }) => {
    await signInAsMember(
      page,
      TARGETED_ANNOUNCEMENTS_READER,
      `/announcements/${targeted.id}`,
      WEB_STOREFRONT_TARGETED_ANNOUNCEMENTS_BASE_URL
    );
    await expect(
      page.getByRole("heading", { level: 1, name: targeted.title })
    ).toBeVisible();
    await signOutStorefront(page);

    await page.goto(targetedStorefrontUrl("/announcements"));
    await expect(listedTitles(page)).toHaveText([newer.title, older.title]);

    await page.goto(targetedStorefrontUrl(`/announcements/${targeted.id}`));
    await expectNotFound(page);
  });

  test("a reader it was not sent to sees neither its row nor its page", async ({
    page,
  }) => {
    await signInAsMember(
      page,
      TARGETED_ANNOUNCEMENTS_OTHER_READER,
      "/announcements",
      WEB_STOREFRONT_TARGETED_ANNOUNCEMENTS_BASE_URL
    );
    await expect(page).toHaveURL(/\/announcements\/?$/u);
    // The unread badge is drawn only for a session, so seeing it is what says
    // the list below was read as this reader rather than as a visitor.
    await expect(page.getByText("2 unread on this page")).toBeVisible();
    await expect(listedTitles(page)).toHaveText([newer.title, older.title]);

    await page.goto(targetedStorefrontUrl(`/announcements/${targeted.id}`));
    await expectNotFound(page);
  });
});
