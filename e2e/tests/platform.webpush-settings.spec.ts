import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";

import { querySql, quoteSqlLiteral, runSql } from "../src/db";
import { signInAsSeedPlatformSuperAdmin } from "../src/platform";

const WEBPUSH_PATH = "/settings/webpush";

const SUBJECT = "mailto:operator@publira.test";
const INVALID_SUBJECT = "operator@publira.test";

const SAVED_MESSAGE = "Web Push settings saved.";
const CONFIGURED_MESSAGE = /^Web Push is configured\./u;
const UNCONFIGURED_MESSAGE = /^Web Push isn't configured yet\./u;
const INVALID_SUBJECT_MESSAGE =
  "Enter a mailto: URI with one email address, such as mailto:push@example.com, or an https:// URL, such as https://example.com/contact.";

const storedRow = (): string =>
  querySql(`SELECT row_to_json(c) FROM platform_webpush_config c;`);

const storedSubject = (): string =>
  querySql(`SELECT COALESCE(subject, '') FROM platform_webpush_config;`);

/**
 * Put back the row `task e2e:db` saved, whose key pair the storefront suites
 * subscribe against. The revision moves past whatever the suite left.
 */
const restoreRow = (snapshot: string): void => {
  const revision = Number(
    querySql(
      `SELECT COALESCE(MAX(revision), 0) FROM platform_webpush_config;`
    ) || "0"
  );
  runSql(`
    DELETE FROM platform_webpush_config;
    INSERT INTO platform_webpush_config
    SELECT * FROM json_populate_record(
      NULL::platform_webpush_config,
      ${quoteSqlLiteral(snapshot)}::json
    );
    UPDATE platform_webpush_config
    SET revision = ${revision + 1}, updated_at = NOW();
  `);
};

const subjectField = (page: Page) =>
  page.getByRole("textbox", { name: /^Contact \(VAPID subject\)/u });

const openWebPushSettings = async (page: Page): Promise<void> => {
  await signInAsSeedPlatformSuperAdmin(page, WEBPUSH_PATH);
  await expect(
    page.getByRole("heading", { exact: true, name: "Web Push" })
  ).toBeVisible();
};

const save = async (page: Page): Promise<void> => {
  await page.getByRole("button", { name: "Save Web Push settings" }).click();
};

/**
 * The Platform Console's Web Push settings: the subject that turns browser
 * notifications on for the whole installation.
 *
 * The row is one for the installation, and the storefront suites subscribe
 * against its key pair, which is why this suite has a project of its own after
 * the parallel ones. It snapshots the row `task e2e:db` saved and puts it back
 * afterwards.
 */
test.describe("web-platform Web Push settings", () => {
  test.describe.configure({ mode: "serial" });

  let snapshot = "";

  test.beforeAll(() => {
    snapshot = storedRow();
    runSql(`
      UPDATE platform_webpush_config
      SET subject = NULL, revision = revision + 1, updated_at = NOW();
    `);
  });

  test.afterAll(() => {
    if (snapshot) {
      restoreRow(snapshot);
    }
  });

  test("an unconfigured platform refuses a subject that is neither form", async ({
    page,
  }) => {
    await openWebPushSettings(page);
    await expect(page.getByText(UNCONFIGURED_MESSAGE)).toBeVisible();
    await expect(subjectField(page)).toHaveValue("");

    await subjectField(page).fill(INVALID_SUBJECT);
    await save(page);

    await expect(page.getByText(INVALID_SUBJECT_MESSAGE)).toBeVisible();
    expect(storedSubject()).toBe("");
  });

  test("a saved subject is read back and turns Web Push on", async ({
    page,
  }) => {
    await openWebPushSettings(page);
    await subjectField(page).fill(SUBJECT);
    await save(page);

    await expect(page.getByText(SAVED_MESSAGE)).toBeVisible();
    await expect(page.getByText(CONFIGURED_MESSAGE)).toBeVisible();
    await expect(page.getByText(UNCONFIGURED_MESSAGE)).toHaveCount(0);
    expect(storedSubject()).toBe(SUBJECT);

    await page.reload();
    await expect(subjectField(page)).toHaveValue(SUBJECT);
    await expect(page.getByText(CONFIGURED_MESSAGE)).toBeVisible();
  });

  test("the save is recorded in the audit log in words", async ({ page }) => {
    await signInAsSeedPlatformSuperAdmin(page, "/audit-logs");

    await expect(
      page.getByText("Updated the Web Push contact").first()
    ).toBeVisible();
  });
});
