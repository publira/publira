import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";

import { signInAsAdmin } from "../src/admin";
import { applyScenarioSql, querySql } from "../src/db";
import {
  CRAWLER_SETTINGS_ADMIN,
  CRAWLER_SETTINGS_EDITOR,
  CRAWLER_SETTINGS_SCENARIO,
  CRAWLER_SETTINGS_TENANT,
} from "../src/scenarios/crawler-settings";
import { WEB_ADMIN_CRAWLER_SETTINGS_BASE_URL } from "../src/urls";

/**
 * A tenant administrator decides from `/settings` which crawlers and paths the
 * site's robots.txt excludes. The console, the API, and the database are what
 * this suite measures: what the saved setting makes of robots.txt is the
 * storefront's to show.
 */

const SAVE = "Save the crawler exclusions";
const SAVED = "The crawler exclusions were saved.";

const ADMIN_ONLY =
  "Only a tenant administrator can change this setting. You have read-only access.";

const crawlerBox = (page: Page, userAgent: string) =>
  page.getByRole("checkbox", { exact: true, name: userAgent });

/** The path list's fields, in order. */
const pathFields = (page: Page) =>
  page.getByRole("textbox", { name: /^Path \d+$/u });

const pathField = (page: Page, position: number) =>
  page.getByRole("textbox", { exact: true, name: `Path ${position}` });

const pathValues = (page: Page) =>
  pathFields(page).evaluateAll((fields: HTMLInputElement[]) =>
    fields.map((field) => field.value)
  );

/** The stored row, as `user agents|paths`, or empty while there is none. */
const storedSetting = (): string =>
  querySql(`
    SELECT array_to_string(s.excluded_user_agents, ',') || '|' ||
      array_to_string(s.excluded_paths, ',')
    FROM tenant_crawler_settings s
    JOIN tenants t ON t.id = s.tenant_id
    WHERE t.public_id = '${CRAWLER_SETTINGS_TENANT}';
  `);

const openSettings = (
  page: Page,
  account: { email: string; password: string } = CRAWLER_SETTINGS_ADMIN
) =>
  signInAsAdmin(
    page,
    account,
    "/settings",
    WEB_ADMIN_CRAWLER_SETTINGS_BASE_URL
  );

// One setting for one tenant, so the tests run in order rather than beside
// each other, and each starts from what the one before it saved.
test.describe.configure({ mode: "serial" });

test.describe("web-admin crawler exclusions", () => {
  test.beforeAll(() => {
    applyScenarioSql(CRAWLER_SETTINGS_SCENARIO);
  });

  test.afterAll(() => {
    applyScenarioSql(CRAWLER_SETTINGS_SCENARIO);
  });

  test("an administrator excludes a crawler and a path, and sees both after a reload", async ({
    page,
  }) => {
    await openSettings(page);

    await expect(crawlerBox(page, "GPTBot")).toHaveAttribute(
      "aria-checked",
      "false"
    );
    // One empty field to type into, for a tenant that excludes nothing.
    await expect.poll(() => pathValues(page)).toEqual([""]);

    await crawlerBox(page, "GPTBot").click();
    await pathField(page, 1).fill("  /drafts/  ");
    await page.getByRole("button", { name: SAVE }).click();

    await expect(page.getByText(SAVED)).toBeVisible();
    // Answered as stored: trimmed and without the trailing slash.
    await expect.poll(() => pathValues(page)).toEqual(["/drafts"]);
    expect(storedSetting()).toBe("GPTBot|/drafts");

    await page.reload();

    await expect(crawlerBox(page, "GPTBot")).toHaveAttribute(
      "aria-checked",
      "true"
    );
    await expect(crawlerBox(page, "ClaudeBot")).toHaveAttribute(
      "aria-checked",
      "false"
    );
    await expect.poll(() => pathValues(page)).toEqual(["/drafts"]);
  });

  test("a path the server would refuse is refused on the form", async ({
    page,
  }) => {
    await openSettings(page);

    await page.getByRole("button", { name: "Add a path" }).click();
    await expect(pathField(page, 2)).toBeFocused();
    await pathField(page, 2).fill("/sitemap.xml");
    await page.getByRole("button", { name: SAVE }).click();

    await expect(
      page
        .getByText(
          '"/sitemap.xml" cannot be excluded, since crawlers need robots.txt and the sitemap to read the site.'
        )
        .first()
    ).toBeVisible();
    await expect(pathField(page, 2)).toHaveAttribute("aria-invalid", "true");
    await expect(page.getByText(SAVED)).toBeHidden();
    expect(storedSetting()).toBe("GPTBot|/drafts");

    await page.reload();

    await expect.poll(() => pathValues(page)).toEqual(["/drafts"]);
  });

  test("an editor sees the saved exclusions read-only", async ({ page }) => {
    await openSettings(page, CRAWLER_SETTINGS_EDITOR);

    await expect(page.getByText(ADMIN_ONLY).first()).toBeVisible();
    await expect(page.getByRole("button", { name: SAVE })).toBeDisabled();
    await expect(crawlerBox(page, "GPTBot")).toHaveAttribute(
      "aria-checked",
      "true"
    );
    await expect(crawlerBox(page, "GPTBot")).toBeDisabled();
    await expect.poll(() => pathValues(page)).toEqual(["/drafts"]);
    await expect(pathField(page, 1)).toBeDisabled();
    await expect(
      page.getByRole("button", { name: "Add a path" })
    ).toBeDisabled();
  });
});
