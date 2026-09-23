import type { APIRequestContext, Locator, Page } from "@playwright/test";
import { expect, test } from "@playwright/test";

import { signInAsAdmin } from "../src/admin";
import { applyScenarioSql, querySql } from "../src/db";
import {
  APP_LINKS_ADMIN,
  APP_LINKS_SCENARIO,
  APP_LINKS_TENANT,
} from "../src/scenarios/app-links";
import {
  WEB_ADMIN_APP_LINKS_BASE_URL,
  WEB_HOST_APP_LINKS_BASE_URL,
  WEB_HOST_BASE_URL,
} from "../src/urls";

/**
 * A tenant administrator naming the Android and iOS apps their site's links
 * open in, and taking one of them away again, and the association documents
 * the tenant's site serves from what was saved.
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

const ASSET_LINKS = "/.well-known/assetlinks.json";
const APPLE_APP_SITE_ASSOCIATION = "/.well-known/apple-app-site-association";

interface AssociationDocument {
  body: unknown;
  contentType: string | undefined;
  status: number;
}

const fetchAssociation = async (
  request: APIRequestContext,
  origin: string,
  path: string
): Promise<AssociationDocument> => {
  const response = await request.get(`${origin}${path}`, {
    headers: { "Cache-Control": "no-cache" },
    maxRedirects: 0,
  });
  return {
    body: response.ok() ? await response.json() : null,
    contentType: response.headers()["content-type"],
    status: response.status(),
  };
};

/**
 * A save revalidates the site's read, which marks it stale rather than
 * dropping it, so the document is polled until it follows.
 */
const expectAssociation = (
  request: APIRequestContext,
  origin: string,
  path: string
) => expect.poll(async () => await fetchAssociation(request, origin, path));

const NOT_SERVED = { body: null, status: 404 };

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

    await expectAssociation(
      page.request,
      WEB_HOST_APP_LINKS_BASE_URL,
      ASSET_LINKS
    ).toStrictEqual({
      body: [
        {
          relation: ["delegate_permission/common.handle_all_urls"],
          target: {
            namespace: "android_app",
            package_name: "com.example.reader",
            sha256_cert_fingerprints: [FINGERPRINT_A, FINGERPRINT_B],
          },
        },
      ],
      contentType: "application/json",
      status: 200,
    });
    await expectAssociation(
      page.request,
      WEB_HOST_APP_LINKS_BASE_URL,
      APPLE_APP_SITE_ASSOCIATION
    ).toMatchObject({
      body: {
        applinks: {
          details: [
            expect.objectContaining({
              appIDs: ["ABCDE12345.com.example.reader"],
              components: expect.arrayContaining([
                { "/": "/series/*" },
                { "/": "/ja/checkout/return" },
              ]),
            }),
          ],
        },
      },
      contentType: "application/json",
      status: 200,
    });

    // The development seed tenant has no app, and nothing stands in for one.
    await expectAssociation(
      page.request,
      WEB_HOST_BASE_URL,
      ASSET_LINKS
    ).toMatchObject(NOT_SERVED);
    await expectAssociation(
      page.request,
      WEB_HOST_BASE_URL,
      APPLE_APP_SITE_ASSOCIATION
    ).toMatchObject(NOT_SERVED);

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

    await expectAssociation(
      page.request,
      WEB_HOST_APP_LINKS_BASE_URL,
      ASSET_LINKS
    ).toMatchObject(NOT_SERVED);
    await expectAssociation(
      page.request,
      WEB_HOST_APP_LINKS_BASE_URL,
      APPLE_APP_SITE_ASSOCIATION
    ).toMatchObject({ status: 200 });

    await page.reload();
    await expect(toggle(page, "Android")).not.toBeChecked();
    await expect(toggle(page, "iOS")).toBeChecked();
  });
});
