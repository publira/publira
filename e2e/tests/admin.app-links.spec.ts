import type { Locator, Page } from "@playwright/test";
import { expect, test } from "@playwright/test";

import { signInAsAdmin } from "../src/admin";
import { applyScenarioSql, querySql } from "../src/db";
import {
  APP_LINKS_ADMIN,
  APP_LINKS_SCENARIO,
  APP_LINKS_TENANT,
} from "../src/scenarios/app-links";
import { WEB_ADMIN_APP_LINKS_BASE_URL } from "../src/urls";

/**
 * A tenant administrator naming the Android and iOS apps their site's links
 * open in, and taking one of them away again.
 */

const APP_LINKS_PATH = "/integrations/app-links";

const SAVED = "The app links were saved.";
const SUBMIT = "Save the app links";

const FINGERPRINT_A = Array.from({ length: 32 }, () => "AB").join(":");
const FINGERPRINT_B = Array.from({ length: 32 }, () => "0C").join(":");

// A scalar subquery, so a tenant with no config row still answers `none`.
const storedAssociation = (): string =>
  querySql(`
    SELECT COALESCE((
      SELECT concat_ws(
        '|',
        COALESCE(android_application_id, '-'),
        array_to_string(android_sha256_cert_fingerprints, ','),
        COALESCE(ios_team_id, '-'),
        COALESCE(ios_bundle_identifier, '-')
      )
      FROM tenant_config
      WHERE tenant_id = (
        SELECT id FROM tenants
        WHERE public_id = '${APP_LINKS_TENANT.publicId}'
      )
    ), 'none');
  `);

const openAppLinks = async (page: Page): Promise<void> => {
  await page.goto(`${WEB_ADMIN_APP_LINKS_BASE_URL}${APP_LINKS_PATH}`);
  await expect(page.getByRole("button", { name: SUBMIT })).toBeVisible();
};

const platform = (page: Page, legend: "Android" | "iOS"): Locator =>
  page.getByRole("group", { exact: true, name: legend });

const toggle = (page: Page, legend: "Android" | "iOS"): Locator =>
  platform(page, legend).getByRole("checkbox", {
    name: `Links open in the tenant's ${legend} app`,
  });

test.describe.configure({ mode: "serial" });

test.beforeAll(() => {
  applyScenarioSql(APP_LINKS_SCENARIO);
});

test.afterAll(() => {
  applyScenarioSql(APP_LINKS_SCENARIO);
});

test.describe("app links", () => {
  test.beforeEach(async ({ page }) => {
    await signInAsAdmin(
      page,
      APP_LINKS_ADMIN,
      APP_LINKS_PATH,
      WEB_ADMIN_APP_LINKS_BASE_URL
    );
  });

  test("names both apps and reads back what the API stored", async ({
    page,
  }) => {
    await openAppLinks(page);
    await expect(toggle(page, "Android")).not.toBeChecked();
    await expect(toggle(page, "iOS")).not.toBeChecked();

    await toggle(page, "Android").click();
    await page.getByLabel("Application ID").fill("com.example.reader");
    await page
      .getByLabel("SHA-256 signing certificate fingerprints")
      .fill(`${FINGERPRINT_A.toLowerCase()}\n\n${FINGERPRINT_B}\n`);
    await toggle(page, "iOS").click();
    await page.getByLabel("Apple Team ID").fill("abcde12345");
    await page.getByLabel("Bundle identifier").fill("com.example.reader");
    await page.getByRole("button", { name: SUBMIT }).click();

    await expect(page.getByText(SAVED)).toBeVisible();
    expect(storedAssociation()).toBe(
      `com.example.reader|${FINGERPRINT_A},${FINGERPRINT_B}|ABCDE12345|com.example.reader`
    );

    await page.reload();
    await expect(page.getByLabel("Apple Team ID")).toHaveValue("ABCDE12345");
    await expect(
      page.getByLabel("SHA-256 signing certificate fingerprints")
    ).toHaveValue(`${FINGERPRINT_A}\n${FINGERPRINT_B}`);
  });

  test("keeps what was typed when a value is refused", async ({ page }) => {
    await openAppLinks(page);
    const before = storedAssociation();

    await page.getByLabel("Apple Team ID").fill("ABCDE");
    await page.getByLabel("Bundle identifier").fill("com.example.other");
    await page.getByRole("button", { name: SUBMIT }).click();

    await expect(
      page.getByText(
        "Enter the Team ID as ten letters and digits, such as ABCDE12345."
      )
    ).toBeVisible();
    await expect(page.getByLabel("Apple Team ID")).toHaveValue("ABCDE");
    await expect(page.getByLabel("Bundle identifier")).toHaveValue(
      "com.example.other"
    );
    expect(storedAssociation()).toBe(before);
  });

  test("clears a platform whose box is unticked", async ({ page }) => {
    await openAppLinks(page);

    await toggle(page, "Android").click();
    await expect(page.getByLabel("Application ID")).toBeDisabled();
    await page.getByRole("button", { name: SUBMIT }).click();

    await expect(page.getByText(SAVED)).toBeVisible();
    expect(storedAssociation()).toBe("-||ABCDE12345|com.example.reader");

    await page.reload();
    await expect(toggle(page, "Android")).not.toBeChecked();
    await expect(toggle(page, "iOS")).toBeChecked();
  });
});
