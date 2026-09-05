import type { Locator, Page } from "@playwright/test";
import { expect, test } from "@playwright/test";

import {
  fillField,
  formMessage,
  signInAsNotificationInboxAdmin,
} from "../src/admin";
import { applyScenarioSql, runSql } from "../src/db";
import {
  signInAsNotificationInboxMember,
  signInAsSeedMember,
} from "../src/host";
import { uniqueSuffix } from "../src/scenarios/admin-publish";
import {
  NOTIFICATION_INBOX_SCENARIO,
  NOTIFICATION_INBOX_TENANT,
} from "../src/scenarios/notification-inbox";
import { hostPath, WEB_HOST_NOTIFICATION_INBOX_BASE_URL } from "../src/urls";

const inboxHostUrl = (pathname: string): string =>
  `${WEB_HOST_NOTIFICATION_INBOX_BASE_URL}${hostPath(pathname)}`;

const announcementFormFields = (page: Page) => ({
  body: page.getByRole("textbox", { name: /Body/u }),
  title: page.getByRole("textbox", { name: /Title/u }),
});

const announcementArticle = (page: Page, title: string): Locator =>
  page.locator("article").filter({
    has: page.getByRole("heading", { exact: true, level: 3, name: title }),
  });

/**
 * Read the member announcement list until it shows `title` as the leading
 * row. The admin write is stored immediately, but the host list is a cached
 * private read and the first navigation after the write can still be served
 * from a stale entry, so this retries the navigation rather than sleeping.
 */
const expectLeadingAnnouncement = async (
  page: Page,
  title: string
): Promise<void> => {
  await expect(async () => {
    await page.goto(inboxHostUrl("/announcements"));
    await expect(page.locator("article h3").first()).toHaveText(title, {
      timeout: 5000,
    });
  }).toPass({ timeout: 30_000 });
};

/**
 * Announcement delivery: the console form under `/announcements/new` and the
 * member list it feeds on the same tenant's web-host.
 *
 * `/announcements` is the delivery list; the header bell is the operational
 * inbox (`host.notifications.spec.ts` / `admin.notifications.spec.ts`). The
 * unread marker this suite asserts is the one on the delivered row.
 *
 * The inbox tenant's accounts exist so a post here cannot land in the seed
 * member's list that `announcements.pagination` pages through, or in the
 * seed tenant an episode publish notifies. Each run uses a unique title and
 * `afterEach` deletes the rows it created, so a long-lived stack does not
 * accumulate them.
 */
test.describe("admin announcement delivery", () => {
  const createdTitles: string[] = [];

  test.beforeAll(() => {
    applyScenarioSql(NOTIFICATION_INBOX_SCENARIO);
    runSql(`
      DELETE FROM announcements a
      USING tenants t
      WHERE a.tenant_id = t.id
        AND t.public_id = '${NOTIFICATION_INBOX_TENANT.publicId}';
    `);
  });

  test.afterEach(() => {
    if (createdTitles.length === 0) {
      return;
    }

    const literals = createdTitles.map(
      (title) => `'${title.replaceAll("'", "''")}'`
    );
    runSql(`
      DELETE FROM announcements a
      USING tenants t
      WHERE a.tenant_id = t.id
        AND t.public_id = '${NOTIFICATION_INBOX_TENANT.publicId}'
        AND a.title IN (${literals.join(", ")});
    `);
    createdTitles.length = 0;
  });

  test("a posted announcement reaches the same tenant's members and not another tenant's", async ({
    page,
  }) => {
    const title = `E2E delivery ${uniqueSuffix()}`;
    const body = `Console delivery body ${uniqueSuffix()}`;
    createdTitles.push(title);

    await signInAsNotificationInboxAdmin(page, "/announcements/new");
    await expect(
      page.getByRole("heading", { name: "Create an announcement" })
    ).toBeVisible();

    const fields = announcementFormFields(page);
    await fillField(fields.title, title);
    await fillField(fields.body, body);
    await fillField(page.getByRole("textbox", { name: /Link/u }), "/my");
    await page
      .getByRole("button", { name: "Deliver the announcement" })
      .click();

    await expect(page).toHaveURL(/\/announcements\/?$/u);
    await expect(
      page.getByRole("cell", { exact: true, name: title })
    ).toBeVisible();

    await signInAsNotificationInboxMember(page, "/announcements");
    await expectLeadingAnnouncement(page, title);

    const delivered = announcementArticle(page, title);
    await expect(delivered.getByText("Unread", { exact: true })).toBeVisible();
    await expect(delivered.getByText(body)).toBeVisible();
    await expect(page.getByText("1 unread on this page")).toBeVisible();

    await signInAsSeedMember(page, "/announcements");
    await expect(
      page.getByRole("heading", {
        exact: true,
        level: 1,
        name: "Announcements",
      })
    ).toBeVisible();
    // The unread badge is on the resolved list, empty or not. Matching it
    // waits out the skeleton without depending on whether another spec has
    // seeded this tenant's inbox.
    await expect(page.getByText(/^\d+ unread on this page$/u)).toBeVisible();
    await expect(
      page.getByRole("heading", { exact: true, level: 3, name: title })
    ).toHaveCount(0);

    await page.goto(inboxHostUrl("/announcements"));
    await expect(delivered.getByText("Unread", { exact: true })).toBeVisible();
    await delivered
      .getByRole("button", { name: "Open and mark as read" })
      .click();
    await expect(page).toHaveURL(/\/my\/?$/u);

    await expect(async () => {
      await page.goto(inboxHostUrl("/announcements"));
      await expect(delivered.getByText("Read", { exact: true })).toBeVisible({
        timeout: 5000,
      });
    }).toPass({ timeout: 30_000 });
    await expect(
      delivered.getByRole("button", { name: "Open and mark as read" })
    ).toHaveCount(0);
  });

  test("a missing required field shows the error instead of submitting", async ({
    page,
  }) => {
    await signInAsNotificationInboxAdmin(page, "/announcements/new");
    const fields = announcementFormFields(page);

    // The controls are `required`, so the browser refuses to submit: the
    // Action never runs, nothing comes back to report, and the form stays put.
    await page
      .getByRole("button", { name: "Deliver the announcement" })
      .click();
    await expect(formMessage(page)).toHaveCount(0);
    await expect(page).toHaveURL(/\/announcements\/new/u);

    // Blanks satisfy the browser; the Action trims before it validates, so
    // this is the path that shows the console's own message.
    await fillField(fields.title, "   ");
    await fillField(fields.body, `Body for ${uniqueSuffix()}`);
    await page
      .getByRole("button", { name: "Deliver the announcement" })
      .click();
    await expect(formMessage(page)).toContainText(/The title is required/u);
    await expect(page).toHaveURL(/\/announcements\/new/u);
  });
});
