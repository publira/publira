import type { Locator, Page } from "@playwright/test";
import { expect, test } from "@playwright/test";

import {
  fillField,
  formMessage,
  signInAsAnnouncementDeliveryAdmin,
  signInAsAnnouncementDeliveryTarget,
} from "../src/admin";
import { applyScenarioSql, querySql, quoteSqlLiteral, runSql } from "../src/db";
import {
  openHostUserMenu,
  signInAsAnnouncementDeliveryMember,
  signInAsSeedMember,
} from "../src/host";
import { uniqueSuffix } from "../src/scenarios/admin-publish";
import {
  ANNOUNCEMENT_DELIVERY_ADMIN,
  ANNOUNCEMENT_DELIVERY_MEMBER,
  ANNOUNCEMENT_DELIVERY_SCENARIO,
  ANNOUNCEMENT_DELIVERY_TARGET,
  ANNOUNCEMENT_DELIVERY_TENANT,
} from "../src/scenarios/announcement-delivery";
import {
  hostPath,
  WEB_ADMIN_ANNOUNCEMENT_DELIVERY_BASE_URL,
  WEB_HOST_ANNOUNCEMENT_DELIVERY_BASE_URL,
} from "../src/urls";

const deliveryHostUrl = (pathname: string): string =>
  `${WEB_HOST_ANNOUNCEMENT_DELIVERY_BASE_URL}${hostPath(pathname)}`;

const deliveryAdminUrl = (pathname: string): string =>
  `${WEB_ADMIN_ANNOUNCEMENT_DELIVERY_BASE_URL}${pathname}`;

/** This tenant's announcement events the worker has still to drain. */
const queuedAnnouncementEvents = (): number =>
  Number(
    querySql(`
      SELECT COUNT(*)
      FROM outbox_events e
      JOIN tenants t ON t.id = e.tenant_id
      WHERE t.public_id = '${ANNOUNCEMENT_DELIVERY_TENANT.publicId}'
        AND e.event_type = 'announcement_notification'
        AND e.status IN ('pending', 'processing');
    `)
  );

/**
 * Who the announcement titled `title` actually notified, by public id.
 *
 * The recipient set is what "and nobody else" means, and a screen can only
 * report the one account it is signed in as — so the whole set is read here,
 * where no cached page stands between the assertion and the rows.
 */
const notifiedUserPublicIds = (title: string): string[] => {
  const rows = querySql(`
    SELECT u.public_id
    FROM notifications n
    JOIN users u ON u.id = n.user_id
    JOIN announcements a ON a.tenant_id = n.tenant_id
      AND n.subject_key = 'announcement:' || a.id::text
    WHERE a.title = ${quoteSqlLiteral(title)}
    ORDER BY u.public_id;
  `);
  return rows === "" ? [] : rows.split("\n");
};

const announcementFormFields = (page: Page) => ({
  body: page.getByRole("textbox", { name: /Body/u }),
  title: page.getByRole("textbox", { name: /Title/u }),
});

const announcementArticle = (page: Page, title: string): Locator =>
  page.locator("article").filter({
    has: page.getByRole("heading", { exact: true, level: 3, name: title }),
  });

/**
 * How one announcement is recognized in a notification inbox. Every row of
 * this type is headed "A new announcement", so what stands for the
 * announcement is the title its description quotes — on the storefront's
 * articles and in the console's table alike.
 */
const notificationMention = (page: Page, title: string): Locator =>
  page.getByText(`“${title}”`);

/** Fill in the console form and deliver it to the audience it names. */
const deliverAnnouncement = async (
  page: Page,
  fields: { body: string; targetUserName?: string; title: string }
): Promise<void> => {
  await expect(
    page.getByRole("heading", { name: "Create an announcement" })
  ).toBeVisible();

  const form = announcementFormFields(page);
  await fillField(form.title, fields.title);
  await fillField(form.body, fields.body);
  if (fields.targetUserName) {
    await page.getByRole("radio", { name: "Selected users" }).check();
    await page
      .getByRole("checkbox", { name: new RegExp(fields.targetUserName, "u") })
      .check();
  }
  await page.getByRole("button", { name: "Deliver the announcement" }).click();
  await expect(page).toHaveURL(/\/announcements\/?$/u);
  await expect(
    page.getByRole("cell", { exact: true, name: fields.title })
  ).toBeVisible();
};

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
    await page.goto(deliveryHostUrl("/announcements"));
    await expect(page.locator("article h3").first()).toHaveText(title, {
      timeout: 5000,
    });
  }).toPass({ timeout: 30_000 });
};

/**
 * Read a notification inbox until the announcement's row is on it and the
 * header bell counts it.
 *
 * What is waited out is the Outbox worker: it writes the notification rows
 * after the console request has already returned. Nothing has to be waited out
 * on the reading side — an inbox read is `"use cache: private"`, which Next.js
 * keeps in no server cache at all and in a client cache that a reload drops, so
 * every `page.goto` here asks the database again. The count is asserted inside
 * the retry because it is a read of its own, and the two land in the same
 * navigation rather than in a fixed order.
 */
const expectUnreadNotification = async (
  page: Page,
  url: string,
  title: string,
  unreadCount: number
): Promise<void> => {
  await expect(async () => {
    await page.goto(url);
    await expect(
      page.getByRole("button", {
        name: `Notifications, ${unreadCount} unread`,
      })
    ).toBeVisible({ timeout: 5000 });
    await expect(notificationMention(page, title)).toHaveCount(1, {
      timeout: 5000,
    });
  }).toPass({ timeout: 60_000 });
};

/**
 * Announcement delivery: the console form under `/announcements/new`, the
 * member list it feeds on the same tenant's web-host, and the notification it
 * raises for every reader it addresses.
 *
 * Its tenant is its own, because a delivery here is a delivery: the bell of
 * everyone the announcement addresses stops being empty, which is exactly what
 * the tenant of `host.notifications.spec.ts` / `admin.notifications.spec.ts`
 * exists to keep. The scenario file empties this tenant and `afterEach` empties
 * it again, so a long-lived stack does not accumulate what the runs delivered.
 */
test.describe("admin announcement delivery", () => {
  test.beforeAll(async () => {
    // The handler does not read the announcement row, so an event a previous
    // run left queued still delivers — and it would deliver after the scenario
    // file has emptied this tenant, into the bell the first test expects to be
    // its own. The file is idempotent DML and cannot wait, so the drain is
    // waited out here, before it is applied.
    await expect.poll(queuedAnnouncementEvents, { timeout: 30_000 }).toBe(0);
    applyScenarioSql(ANNOUNCEMENT_DELIVERY_SCENARIO);
  });

  test.afterEach(async () => {
    // The notification rows are written after the console request has
    // returned, so a clean-up that ran before the worker drained the event
    // would leave them behind for the next test's bell to count.
    await expect.poll(queuedAnnouncementEvents, { timeout: 30_000 }).toBe(0);
    runSql(`
      DELETE FROM notifications n
      USING tenants t
      WHERE n.tenant_id = t.id
        AND t.public_id = '${ANNOUNCEMENT_DELIVERY_TENANT.publicId}';
      DELETE FROM announcements a
      USING tenants t
      WHERE a.tenant_id = t.id
        AND t.public_id = '${ANNOUNCEMENT_DELIVERY_TENANT.publicId}';
    `);
  });

  test("a posted announcement reaches the same tenant's members and not another tenant's", async ({
    page,
  }) => {
    const title = `E2E delivery ${uniqueSuffix()}`;
    const body = `Console delivery body ${uniqueSuffix()}`;

    await signInAsAnnouncementDeliveryAdmin(page, "/announcements/new");
    await deliverAnnouncement(page, { body, title });

    // The reader lands on another screen and reaches the inbox through the
    // header account menu, which is the navigation that points at it. Going
    // straight to `/announcements` would assert delivery to a page nothing
    // leads to.
    await signInAsAnnouncementDeliveryMember(page);
    await openHostUserMenu(page);
    await page.getByRole("menuitem", { name: "Announcements" }).click();
    await expect(page).toHaveURL(/\/announcements\/?$/u);
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
  });

  test("a posted announcement raises the addressed reader's unread notification count", async ({
    page,
  }) => {
    const title = `E2E bell ${uniqueSuffix()}`;

    await signInAsAnnouncementDeliveryAdmin(page, "/announcements/new");
    await deliverAnnouncement(page, {
      body: `Bell delivery body ${uniqueSuffix()}`,
      title,
    });

    await signInAsAnnouncementDeliveryMember(page);
    await expectUnreadNotification(
      page,
      deliveryHostUrl("/notifications"),
      title,
      1
    );

    const row = page
      .locator("article")
      .filter({ hasText: `“${title}”` })
      .first();
    await expect(
      row.getByRole("heading", {
        exact: true,
        level: 3,
        name: "A new announcement",
      })
    ).toBeVisible();
    await expect(row.getByText("Unread", { exact: true })).toBeVisible();

    // The bell's own row opens the announcements inbox rather than a screen of
    // its own.
    const bell = page.getByRole("button", { name: "Notifications, 1 unread" });
    await bell.click();
    const menu = page.getByRole("dialog");
    await expect(menu.getByText(`“${title}”`)).toBeVisible();
    await menu.getByRole("link", { name: /A new announcement/u }).click();
    await expect(page).toHaveURL(/\/announcements\/?$/u);

    // A broadcast addresses every user of its own tenant and stops there, which
    // is the whole recipient set rather than the one account a screen can show.
    expect(notifiedUserPublicIds(title)).toEqual([
      ANNOUNCEMENT_DELIVERY_ADMIN.publicId,
      ANNOUNCEMENT_DELIVERY_MEMBER.publicId,
      ANNOUNCEMENT_DELIVERY_TARGET.publicId,
    ]);

    // The tenant boundary: another tenant's reader is addressed by none of it.
    await signInAsSeedMember(page, "/notifications");
    await expect(
      page.getByRole("heading", {
        exact: true,
        level: 1,
        name: "Notifications",
      })
    ).toBeVisible();
    await expect(notificationMention(page, title)).toHaveCount(0);
  });

  test("a targeted announcement notifies its recipient and nobody else", async ({
    page,
  }) => {
    const title = `E2E targeted ${uniqueSuffix()}`;

    await signInAsAnnouncementDeliveryAdmin(page, "/announcements/new");
    await deliverAnnouncement(page, {
      body: `Targeted delivery body ${uniqueSuffix()}`,
      targetUserName: ANNOUNCEMENT_DELIVERY_TARGET.name,
      title,
    });

    await signInAsAnnouncementDeliveryTarget(page, "/");
    await expectUnreadNotification(
      page,
      deliveryAdminUrl("/notifications"),
      title,
      1
    );

    // Every row this announcement wrote, read straight from the database: the
    // screens below can each speak for one account, and "nobody else" is a
    // statement about all of them.
    expect(notifiedUserPublicIds(title)).toEqual([
      ANNOUNCEMENT_DELIVERY_TARGET.publicId,
    ]);

    // The reader of the same tenant was not addressed, so the announcement
    // reaches neither their inbox nor their bell. This is read once rather than
    // retried: the recipient set above was taken after the event had been
    // drained, so a row for this reader would already exist, and the inbox
    // carries nothing from the preceding test — its reads are
    // `"use cache: private"`, which is never stored across requests.
    await signInAsAnnouncementDeliveryMember(page, "/notifications");
    await expect(
      page.getByRole("button", { name: "Notifications, none unread" })
    ).toBeVisible();
    await expect(notificationMention(page, title)).toHaveCount(0);
  });

  test("a missing required field shows the error instead of submitting", async ({
    page,
  }) => {
    await signInAsAnnouncementDeliveryAdmin(page, "/announcements/new");
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
