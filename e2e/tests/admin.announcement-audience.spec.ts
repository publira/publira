import type { Locator, Page } from "@playwright/test";
import { expect, test } from "@playwright/test";

import { fillField, signInAsAdmin } from "../src/admin";
import { applyScenarioSql, querySql, quoteSqlLiteral, runSql } from "../src/db";
import {
  toSeedTenantDateTimeLocal,
  uniqueSuffix,
} from "../src/scenarios/admin-publish";
import {
  ANNOUNCEMENT_AUDIENCE_EDITOR,
  ANNOUNCEMENT_AUDIENCE_FOLLOWER,
  ANNOUNCEMENT_AUDIENCE_PLAN,
  ANNOUNCEMENT_AUDIENCE_READER,
  ANNOUNCEMENT_AUDIENCE_SCENARIO,
  ANNOUNCEMENT_AUDIENCE_SERIES,
  ANNOUNCEMENT_AUDIENCE_TENANT,
} from "../src/scenarios/announcement-audience";
import { WEB_ADMIN_ANNOUNCEMENT_AUDIENCE_BASE_URL } from "../src/urls";

/** This tenant's announcement events the worker has still to drain. */
const queuedAnnouncementEvents = (): number =>
  Number(
    querySql(`
      SELECT COUNT(*)
      FROM outbox_events e
      JOIN tenants t ON t.id = e.tenant_id
      WHERE t.public_id = '${ANNOUNCEMENT_AUDIENCE_TENANT.publicId}'
        AND e.event_type = 'announcement_notification'
        AND e.status IN ('pending', 'processing');
    `)
  );

/**
 * Who the announcement titled `title` notified, by public id. A screen can
 * only report the one account it is signed in as, so the whole recipient set
 * is read where no cached page stands between the assertion and the rows.
 */
const notifiedUserPublicIds = (title: string): string[] => {
  const rows = querySql(`
    SELECT u.public_id
    FROM notifications n
    JOIN users u ON u.id = n.user_id
    JOIN announcement_translations at ON at.tenant_id = n.tenant_id
      AND n.subject_key = 'announcement:' || at.announcement_id::text
    WHERE at.title = ${quoteSqlLiteral(title)}
    ORDER BY u.public_id;
  `);

  return rows === "" ? [] : rows.split("\n");
};

/** The announcement titled `title` as it is stored: when it goes and went out. */
const storedSchedule = (
  title: string
): { deliverAt: string; deliveredAt: string } | null => {
  const row = querySql(`
    SELECT
      COALESCE(to_char(a.deliver_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI'), ''),
      COALESCE(to_char(a.delivered_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI'), '')
    FROM announcements a
    JOIN announcement_translations at ON at.announcement_id = a.id
    WHERE at.title = ${quoteSqlLiteral(title)};
  `);

  if (row === "") {
    return null;
  }

  const [deliverAt = "", deliveredAt = ""] = row.split("|");

  return { deliverAt, deliveredAt };
};

const signInAsEditor = (page: Page, nextPath: string) =>
  signInAsAdmin(
    page,
    ANNOUNCEMENT_AUDIENCE_EDITOR,
    nextPath,
    WEB_ADMIN_ANNOUNCEMENT_AUDIENCE_BASE_URL
  );

/** Fill in the title and the body of the default language. */
const fillAnnouncement = async (page: Page, title: string) => {
  await expect(
    page.getByRole("heading", { name: "Create an announcement" })
  ).toBeVisible();
  await fillField(page.getByRole("textbox", { name: /Title/u }), title);
  await fillField(
    page.getByRole("textbox", { name: /Body/u }),
    `Body for ${title}`
  );
};

/** Pick `name` in the Select whose trigger `trigger` is. */
const pickOption = async (trigger: Locator, name: string) => {
  await trigger.click();
  await trigger.page().getByRole("option", { exact: true, name }).click();
};

/** One condition's row on the form, named after the condition. */
const conditionRow = (page: Page, name: string): Locator =>
  page.getByRole("group", { exact: true, name });

const addCondition = async (page: Page, name: string) => {
  await pickOption(
    page.getByRole("combobox", { name: "Add a condition" }),
    name
  );
  await expect(conditionRow(page, name)).toBeVisible();
};

/**
 * Fills a `datetime-local` field until it holds the value. The field is
 * controlled, so a fill that lands before the page hydrates is reset by the
 * first render, and the form would post no instant for it.
 */
const fillDeliverAt = async (page: Page, value: string) => {
  // The router keeps a screen it has left in the document, hidden, so a second
  // visit to the edit screen finds the first one's field as well.
  const field = page
    .getByLabel("Deliver at", { exact: true })
    .filter({ visible: true });

  await expect(async () => {
    await field.fill(value);
    await expect(field).toHaveValue(value, { timeout: 1000 });
  }).toPass();
};

const announcementRow = (page: Page, title: string): Locator =>
  page.getByRole("row").filter({
    has: page.getByRole("cell", { exact: true, name: title }),
  });

/** The cell of `row` under the column headed `header`. */
const columnCell = async (
  page: Page,
  row: Locator,
  header: string
): Promise<Locator> => {
  const headers = await page.getByRole("columnheader").allTextContents();

  return row.getByRole("cell").nth(headers.indexOf(header));
};

/**
 * Reloads the list until the row titled `title` reports `delivered` and
 * `opened`. The list the redirect lands on was read before the worker wrote
 * the notification rows, and the counts are read again only with the list.
 */
const expectReaderCounts = async (
  page: Page,
  title: string,
  delivered: string,
  opened: string
) => {
  await expect(async () => {
    await page.reload();

    const row = announcementRow(page, title);

    await expect(await columnCell(page, row, "Delivered")).toHaveText(
      delivered,
      { timeout: 1000 }
    );
    await expect(await columnCell(page, row, "Opened")).toHaveText(opened, {
      timeout: 1000,
    });
  }).toPass({ timeout: 30_000 });
};

/** Records `userPublicId` opening the announcement titled `title`, as the storefront does. */
const openAnnouncementAs = (title: string, userPublicId: string) =>
  runSql(`
    INSERT INTO announcement_reads (announcement_id, tenant_id, user_id)
    SELECT at.announcement_id, at.tenant_id, u.id
    FROM announcement_translations at
    JOIN users u ON u.tenant_id = at.tenant_id
    WHERE at.title = ${quoteSqlLiteral(title)}
      AND u.public_id = ${quoteSqlLiteral(userPublicId)};
  `);

/**
 * Targeted and scheduled announcements, posted by a tenant editor: the
 * audience conditions on `/announcements/new` and the readers they reach, and a
 * scheduled announcement edited, delivered, and deleted from its edit screen.
 *
 * Its tenant is its own, for the reason `admin.announcement-delivery.spec.ts`
 * has one: a delivery notifies the readers it selects, and a scheduled
 * announcement stays on the list. The scenario file empties the tenant and
 * `afterEach` empties it again.
 */
test.describe("admin announcement audience and schedule", () => {
  test.beforeAll(async () => {
    // An event a previous run left queued still delivers, into the bell of a
    // reader this run counts, so the drain is waited out before the tenant is
    // emptied.
    await expect.poll(queuedAnnouncementEvents, { timeout: 30_000 }).toBe(0);
    applyScenarioSql(ANNOUNCEMENT_AUDIENCE_SCENARIO);
  });

  test.afterEach(async () => {
    await expect.poll(queuedAnnouncementEvents, { timeout: 30_000 }).toBe(0);
    runSql(`
      DELETE FROM notifications n
      USING tenants t
      WHERE n.tenant_id = t.id
        AND t.public_id = '${ANNOUNCEMENT_AUDIENCE_TENANT.publicId}';
      DELETE FROM announcements a
      USING tenants t
      WHERE a.tenant_id = t.id
        AND t.public_id = '${ANNOUNCEMENT_AUDIENCE_TENANT.publicId}';
    `);
  });

  test("an announcement addressed to a series' followers in one language reaches the follower and nobody else", async ({
    page,
  }) => {
    const title = `E2E audience ${uniqueSuffix()}`;

    await signInAsEditor(page, "/announcements/new");
    await fillAnnouncement(page, title);

    const sendToEveryone = page.getByRole("checkbox", {
      name: "Send to everyone",
    });

    const banner = page.getByRole("checkbox", {
      name: "Show as a site banner",
    });

    await expect(sendToEveryone).toBeEnabled();

    await page
      .getByRole("radio", { name: "Readers who match all of these conditions" })
      .click();
    await addCondition(page, "Follows series");

    // A condition rules out what reaches readers it does not select.
    await expect(sendToEveryone).toBeDisabled();
    await expect(banner).toBeDisabled();

    const series = conditionRow(page, "Follows series").getByRole("combobox");
    await series.fill("Audience");
    await page
      .getByRole("option", { name: ANNOUNCEMENT_AUDIENCE_SERIES.title })
      .click();

    // The follower is the one reader who follows the series.
    await expect(
      page.getByText("Reaches 1 reader", { exact: true })
    ).toBeVisible();

    await addCondition(page, "Language");
    // The site's default language is the one the row opens on, and the one a
    // reader who never chose a language is counted in.
    await expect(
      conditionRow(page, "Language").getByRole("combobox")
    ).toHaveText("English");
    await expect(
      page.getByText("Reaches 1 reader", { exact: true })
    ).toBeVisible();

    await page
      .getByRole("button", { name: "Deliver the announcement" })
      .click();
    await expect(page).toHaveURL(/\/announcements\/?$/u);

    const row = announcementRow(page, title);
    await expect(row.getByText("2 conditions", { exact: true })).toBeVisible();
    await expect(row.getByText(/^Delivered /u)).toBeVisible();
    await expect(row.getByRole("link", { name: "Edit" })).toHaveCount(0);

    // The whole recipient set: the follower, and not the reader who does not
    // follow the series, nor the editor who posted it.
    await expect
      .poll(() => notifiedUserPublicIds(title), { timeout: 30_000 })
      .toEqual([ANNOUNCEMENT_AUDIENCE_FOLLOWER.publicId]);

    // The list counts the one reader it reached, and that reader opening it.
    openAnnouncementAs(title, ANNOUNCEMENT_AUDIENCE_FOLLOWER.publicId);
    await expectReaderCounts(page, title, "1", "1");
  });

  test("an editor picks a plan by its name, and the announcement reaches the plan's subscriber and nobody else", async ({
    page,
  }) => {
    const title = `E2E plan audience ${uniqueSuffix()}`;

    await signInAsEditor(page, "/announcements/new");
    await fillAnnouncement(page, title);
    await page
      .getByRole("radio", { name: "Readers who match all of these conditions" })
      .click();
    await addCondition(page, "Subscription");

    await pickOption(
      conditionRow(page, "Subscription").getByRole("combobox", {
        name: "Plan",
      }),
      ANNOUNCEMENT_AUDIENCE_PLAN.name
    );
    await expect(
      page.getByText("Reaches 1 reader", { exact: true })
    ).toBeVisible();

    await page
      .getByRole("button", { name: "Deliver the announcement" })
      .click();
    await expect(page).toHaveURL(/\/announcements\/?$/u);

    await expect
      .poll(() => notifiedUserPublicIds(title), { timeout: 30_000 })
      .toEqual([ANNOUNCEMENT_AUDIENCE_READER.publicId]);
  });

  test("removing every condition opens Send to everyone and the banner again", async ({
    page,
  }) => {
    await signInAsEditor(page, "/announcements/new");

    const sendToEveryone = page.getByRole("checkbox", {
      name: "Send to everyone",
    });

    await page
      .getByRole("radio", { name: "Readers who match all of these conditions" })
      .click();
    await addCondition(page, "Has never bought anything");
    await expect(sendToEveryone).toBeDisabled();

    await conditionRow(page, "Has never bought anything")
      .getByRole("button", { name: "Remove" })
      .click();

    await expect(sendToEveryone).toBeEnabled();
    await expect(
      page.getByRole("checkbox", { name: "Show as a site banner" })
    ).toBeEnabled();
  });

  test("a scheduled announcement is edited, then delivered by saving it with no time", async ({
    page,
  }) => {
    const title = `E2E scheduled ${uniqueSuffix()}`;

    const tomorrow = toSeedTenantDateTimeLocal(
      Temporal.Now.instant().add({ hours: 24 })
    );

    const dayAfter = toSeedTenantDateTimeLocal(
      Temporal.Now.instant().add({ hours: 48 })
    );

    await signInAsEditor(page, "/announcements/new");
    await fillAnnouncement(page, title);
    await fillDeliverAt(page, tomorrow);
    await page
      .getByRole("button", { name: "Schedule the announcement" })
      .click();
    await expect(page).toHaveURL(/\/announcements\/?$/u);

    const row = announcementRow(page, title);
    await expect(row.getByText(/^Scheduled for /u)).toBeVisible();
    expect(storedSchedule(title)).toEqual({
      deliverAt: tomorrow,
      deliveredAt: "",
    });
    // Nobody has been sent it yet, so there is nothing to count.
    await expect(await columnCell(page, row, "Delivered")).toHaveText("—");
    await expect(await columnCell(page, row, "Opened")).toHaveText("—");

    await row.getByRole("link", { name: "Edit" }).click();
    await expect(
      page.getByRole("heading", { name: "Edit the scheduled announcement" })
    ).toBeVisible();
    await expect(page.getByRole("textbox", { name: /Title/u })).toHaveValue(
      title
    );
    await fillDeliverAt(page, dayAfter);
    await page.getByRole("button", { exact: true, name: "Save" }).click();
    await expect(page).toHaveURL(/\/announcements\/?$/u);
    await expect(row.getByText(/^Scheduled for /u)).toBeVisible();
    expect(storedSchedule(title)).toEqual({
      deliverAt: dayAfter,
      deliveredAt: "",
    });
    // Nothing has gone out while it waits.
    expect(notifiedUserPublicIds(title)).toEqual([]);

    await row.getByRole("link", { name: "Edit" }).click();
    await fillDeliverAt(page, "");
    await page.getByRole("button", { exact: true, name: "Save" }).click();
    await expect(page).toHaveURL(/\/announcements\/?$/u);
    await expect(row.getByText(/^Delivered /u)).toBeVisible();
    await expect(row.getByRole("link", { name: "Edit" })).toHaveCount(0);
    expect(storedSchedule(title)?.deliveredAt).not.toBe("");
    // Addressed to everyone, it reaches every account of the tenant.
    await expect
      .poll(() => notifiedUserPublicIds(title).length, { timeout: 30_000 })
      .toBe(3);
    await expectReaderCounts(page, title, "3", "0");
  });

  test("a scheduled announcement is deleted from its edit screen", async ({
    page,
  }) => {
    const title = `E2E deleted ${uniqueSuffix()}`;

    await signInAsEditor(page, "/announcements/new");
    await fillAnnouncement(page, title);
    await fillDeliverAt(
      page,
      toSeedTenantDateTimeLocal(Temporal.Now.instant().add({ hours: 24 }))
    );
    await page
      .getByRole("button", { name: "Schedule the announcement" })
      .click();
    await expect(page).toHaveURL(/\/announcements\/?$/u);

    await announcementRow(page, title)
      .getByRole("link", { name: "Edit" })
      .click();
    await page.getByRole("button", { exact: true, name: "Delete" }).click();
    await page
      .getByRole("alertdialog")
      .getByRole("button", { exact: true, name: "Delete" })
      .click();

    await expect(page).toHaveURL(/\/announcements\/?$/u);
    await expect(announcementRow(page, title)).toHaveCount(0);
    expect(storedSchedule(title)).toBeNull();
  });

  test("a delivery time that has passed is refused next to the field", async ({
    page,
  }) => {
    const title = `E2E past ${uniqueSuffix()}`;

    await signInAsEditor(page, "/announcements/new");
    await fillAnnouncement(page, title);
    await fillDeliverAt(
      page,
      toSeedTenantDateTimeLocal(Temporal.Now.instant().subtract({ hours: 1 }))
    );
    await page
      .getByRole("button", { name: "Schedule the announcement" })
      .click();

    await expect(
      page
        .getByText("The announcement has to go out at a time in the future.")
        .first()
    ).toBeVisible();
    await expect(page).toHaveURL(/\/announcements\/new/u);
    expect(storedSchedule(title)).toBeNull();
  });
});
