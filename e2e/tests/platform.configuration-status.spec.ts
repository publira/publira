import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";

import {
  restorePlatformSettingsRow,
  runSql,
  snapshotPlatformSettingsRow,
} from "../src/db";
import { STACK_STORAGE, signInAsSeedPlatformSuperAdmin } from "../src/platform";

const DASHBOARD_NOTICE =
  "Some settings the platform needs aren't set up yet, so parts of it won't work.";
const NEEDS_SETUP_SUMMARY =
  "Some settings the platform needs aren't set up yet. Open each item marked Needs setup to finish it.";
const READY_SUMMARY =
  "Everything the platform needs is set up. Optional features can stay off until you want them.";
const STORAGE_UNCONFIGURED =
  "No storage is saved, so images can't be uploaded or shown.";
const WEBPUSH_UNCONFIGURED =
  "Readers aren't offered browser notifications. Set this up only if you want to send them.";

/** One area's row of the overview, found by the name in its first cell. */
const areaRow = (page: Page, name: string) =>
  page.getByRole("row").filter({ hasText: name });

/**
 * The Platform Console's configuration overview: which areas of the
 * installation are ready, which the platform cannot work without, and which
 * are optional integrations it can run without indefinitely.
 *
 * It empties the storage row and the Web Push subject, both one for the whole
 * installation, which is why this suite has a project of its own after the
 * parallel ones. Both rows are put back afterwards.
 */
test.describe("web-platform configuration overview", () => {
  test.describe.configure({ mode: "serial" });

  let storageSnapshot = "";
  let webPushSnapshot = "";

  test.beforeAll(() => {
    storageSnapshot = snapshotPlatformSettingsRow("platform_storage_config");
    webPushSnapshot = snapshotPlatformSettingsRow("platform_webpush_config");
    runSql(`
      DELETE FROM platform_storage_config;
      UPDATE platform_webpush_config
      SET subject = NULL, revision = revision + 1, updated_at = NOW();
    `);
  });

  test.afterAll(() => {
    if (storageSnapshot) {
      restorePlatformSettingsRow("platform_storage_config", storageSnapshot);
    }
    if (webPushSnapshot) {
      restorePlatformSettingsRow("platform_webpush_config", webPushSnapshot);
    }
  });

  test("a missing required setting is pointed out and fixed from the overview", async ({
    page,
  }) => {
    await signInAsSeedPlatformSuperAdmin(page, "/");
    await expect(page.getByText(DASHBOARD_NOTICE)).toBeVisible();
    await page.getByRole("link", { name: "Review settings" }).click();
    await expect(page).toHaveURL(/\/settings$/u);

    await expect(page.getByText(NEEDS_SETUP_SUMMARY)).toBeVisible();
    const storage = areaRow(page, "Image storage");
    await expect(storage).toContainText("Required");
    await expect(storage).toContainText("Needs setup");
    await expect(storage).toContainText(STORAGE_UNCONFIGURED);

    // An optional integration left off is a state, not a problem to fix.
    const webPush = areaRow(page, "Browser notifications");
    await expect(webPush).toContainText("Optional");
    await expect(webPush).toContainText("Not set up");
    await expect(webPush).toContainText(WEBPUSH_UNCONFIGURED);
    await expect(webPush).not.toContainText("Needs setup");

    await expect(areaRow(page, "Email delivery")).toContainText("Configured");

    await storage.getByRole("link", { name: "Set up" }).click();
    await expect(page).toHaveURL(/\/settings\/storage$/u);
    await page
      .getByRole("textbox", { name: /^Bucket/u })
      .fill(STACK_STORAGE.bucket);
    await page
      .getByRole("textbox", { name: /^Region/u })
      .fill(STACK_STORAGE.region);
    await page
      .getByRole("textbox", { name: /^Endpoint/u })
      .fill(STACK_STORAGE.endpoint);
    await page
      .getByRole("checkbox", { name: "Use path-style addressing" })
      .check();
    await page.getByRole("button", { name: "Save storage settings" }).click();
    await expect(page.getByText("Storage settings saved.")).toBeVisible();

    // A client navigation, so the overview is read after the save cleared it.
    await page.getByRole("link", { exact: true, name: "Overview" }).click();
    await expect(page).toHaveURL(/\/settings$/u);
    await expect(page.getByText(READY_SUMMARY)).toBeVisible();
    await expect(storage).toContainText("Configured");
    await expect(storage).toContainText(
      `Uploaded images are stored in the ${STACK_STORAGE.bucket} bucket.`
    );
    await expect(webPush).toContainText("Not set up");
    await expect(page.getByText("Needs setup")).toHaveCount(0);

    await page.getByRole("link", { name: "Dashboard" }).click();
    await expect(
      page.getByRole("heading", {
        level: 1,
        name: "Cross-tenant operations hub",
      })
    ).toBeVisible();
    await expect(page.getByText(DASHBOARD_NOTICE)).toHaveCount(0);
  });
});
