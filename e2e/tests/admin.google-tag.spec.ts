import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";

import { signInAsAdmin } from "../src/admin";
import { applyScenarioSql, querySql, runSql } from "../src/db";
import {
  GOOGLE_TAG_ADMIN,
  GOOGLE_TAG_SCENARIO,
  GOOGLE_TAG_TENANT,
} from "../src/scenarios/google-tag";
import { WEB_ADMIN_GOOGLE_TAG_BASE_URL } from "../src/urls";

/**
 * A tenant administrator entering the Google tag their site loads, in each of
 * the three places it can be loaded from, regenerating the gateway path, and
 * choosing whether readers are asked before the tag runs.
 */

const GOOGLE_TAG_PATH = "/integrations/google-tag";

const SAVED = "The Google tag settings were saved.";
const SUBMIT = "Save the Google tag";

const MEASUREMENT_ID = "G-ABC123DEF4";
const CONTAINER_ID = "GTM-XYZ7890";
const SERVER_CONTAINER_URL = "https://sgtm.example.com";

/** A generated gateway path as the form shows it. */
const GATEWAY_PATH_RE = /^\/_[a-z2-7]{16}$/u;

// A scalar subquery, so a tenant with no settings row still answers `none`.
const storedSettings = (): string =>
  querySql(`
    SELECT COALESCE((
      SELECT concat_ws(
        '|',
        COALESCE(ga4_measurement_id, '-'),
        COALESCE(gtm_container_id, '-'),
        serving_mode,
        COALESCE(server_container_url, '-'),
        COALESCE(gateway_path, '-')
      )
      FROM tenant_analytics_settings
      WHERE tenant_id = (
        SELECT id FROM tenants
        WHERE public_id = '${GOOGLE_TAG_TENANT.publicId}'
      )
    ), 'none');
  `);

const TENANT_ID_SQL = `(SELECT id FROM tenants WHERE public_id = '${GOOGLE_TAG_TENANT.publicId}')`;

const storedConsentMode = (): string =>
  querySql(`
    SELECT consent_mode FROM tenant_analytics_settings
    WHERE tenant_id = ${TENANT_ID_SQL};
  `);

/** The published page `570_google_tag.sql` seeds without naming it. */
const PRIVACY_PAGE_ID = "018f1110-0004-7000-8000-000000000001";

const PRIVACY_PAGE_MISSING =
  "No published privacy policy page is chosen under Settings › Terms and privacy policy, so the banner has no page to link to.";

const openGoogleTagSettings = async (page: Page): Promise<void> => {
  await page.goto(`${WEB_ADMIN_GOOGLE_TAG_BASE_URL}${GOOGLE_TAG_PATH}`);
  await expect(
    page.getByRole("heading", { exact: true, level: 1, name: "Google tag" })
  ).toBeVisible();
};

const measurementId = (page: Page) =>
  page.getByRole("textbox", { name: "GA4 measurement ID" });
const containerId = (page: Page) =>
  page.getByRole("textbox", { name: "Tag Manager container ID" });
const serverContainerUrl = (page: Page) =>
  page.getByRole("textbox", { name: /^Server container URL/u });
/** A serving mode or a reader consent choice, by its label. */
const choice = (page: Page, name: string) =>
  page.getByRole("radio", { exact: true, name });

/** The gateway path the form shows, read off the copyable value. */
const shownGatewayPath = async (page: Page): Promise<string> => {
  const path = page.getByText(GATEWAY_PATH_RE);
  await expect(path).toBeVisible();
  return (await path.textContent()) ?? "";
};

test.describe.configure({ mode: "serial" });

test.beforeAll(() => {
  applyScenarioSql(GOOGLE_TAG_SCENARIO);
});

test.afterAll(() => {
  applyScenarioSql(GOOGLE_TAG_SCENARIO);
});

test.describe("Google tag settings", () => {
  test.beforeEach(async ({ page }) => {
    await signInAsAdmin(
      page,
      GOOGLE_TAG_ADMIN,
      GOOGLE_TAG_PATH,
      WEB_ADMIN_GOOGLE_TAG_BASE_URL
    );
  });

  test("saves the IDs loaded from Google and shows them after a reload", async ({
    page,
  }) => {
    await openGoogleTagSettings(page);
    await expect(choice(page, "Google")).toBeChecked();
    await expect(serverContainerUrl(page)).toHaveCount(0);

    await measurementId(page).fill(" g-abc123def4 ");
    await containerId(page).fill("gtm-xyz7890");
    await page.getByRole("button", { name: SUBMIT }).click();

    await expect(page.getByText(SAVED)).toBeVisible();
    expect(storedSettings()).toBe(
      `${MEASUREMENT_ID}|${CONTAINER_ID}|google|-|-`
    );

    await page.reload();
    await expect(measurementId(page)).toHaveValue(MEASUREMENT_ID);
    await expect(containerId(page)).toHaveValue(CONTAINER_ID);
    await expect(choice(page, "Google")).toBeChecked();
  });

  test("reports an invalid value next to its field and saves nothing", async ({
    page,
  }) => {
    await openGoogleTagSettings(page);
    const before = storedSettings();

    await measurementId(page).fill("UA-1234-1");
    await page.getByRole("button", { name: SUBMIT }).click();

    await expect(
      page.getByText(
        "Google no longer collects data for a Universal Analytics ID (UA-). Enter a Google Analytics 4 measurement ID, starting G-."
      )
    ).toBeVisible();
    await expect(measurementId(page)).toHaveValue("UA-1234-1");
    expect(storedSettings()).toBe(before);
  });

  test("saves a server container with the URL it is loaded from", async ({
    page,
  }) => {
    await openGoogleTagSettings(page);

    await choice(page, "Server container").click();
    await page.getByRole("button", { name: SUBMIT }).click();
    await expect(
      page.getByText(
        "Enter the server container URL to load the tag from your server container."
      )
    ).toBeVisible();
    expect(storedSettings().split("|")[2]).toBe("google");

    await serverContainerUrl(page).fill(SERVER_CONTAINER_URL);
    await page.getByRole("button", { name: SUBMIT }).click();

    await expect(page.getByText(SAVED)).toBeVisible();
    expect(storedSettings()).toBe(
      `${MEASUREMENT_ID}|${CONTAINER_ID}|server_container|${SERVER_CONTAINER_URL}|-`
    );

    await page.reload();
    await expect(choice(page, "Server container")).toBeChecked();
    await expect(serverContainerUrl(page)).toHaveValue(SERVER_CONTAINER_URL);
  });

  test("saves the gateway, which generates a path to register and regenerate", async ({
    page,
  }) => {
    await openGoogleTagSettings(page);

    await choice(page, "Google tag gateway").click();
    await expect(
      page.getByText("A path is generated when you save in this mode.")
    ).toBeVisible();
    // Fronting the server container is optional, and the URL carries over.
    await expect(serverContainerUrl(page)).toHaveValue(SERVER_CONTAINER_URL);
    await serverContainerUrl(page).fill("");
    await page.getByRole("button", { name: SUBMIT }).click();

    await expect(page.getByText(SAVED)).toBeVisible();
    const path = await shownGatewayPath(page);
    // The container is what the gateway forwards for whenever one is set.
    await expect(page.getByText(CONTAINER_ID, { exact: true })).toBeVisible();
    expect(storedSettings()).toBe(
      `${MEASUREMENT_ID}|${CONTAINER_ID}|gateway|-|${path.slice(1)}`
    );

    await page.reload();
    await expect(choice(page, "Google tag gateway")).toBeChecked();
    expect(await shownGatewayPath(page)).toBe(path);

    await page.getByRole("button", { name: "Generate a new path" }).click();
    await page
      .getByRole("alertdialog")
      .getByRole("button", { name: "Generate and save" })
      .click();

    await expect(
      page.getByText(
        "A new gateway path was generated, and the Google tag settings were saved."
      )
    ).toBeVisible();
    await expect(page.getByText(path, { exact: true })).toHaveCount(0);
    const regenerated = await shownGatewayPath(page);
    expect(regenerated).not.toBe(path);
    expect(storedSettings().split("|")[4]).toBe(regenerated.slice(1));
  });

  // In this order, so the last one saved leaves the tenant asking no one.
  for (const [name, stored] of [
    ["Ask readers first", "opt_in"],
    ["Handled by my own consent tool in Tag Manager", "external"],
    ["Not required", "not_required"],
  ] as const) {
    test(`saves the reader consent choice ${name} and shows it after a reload`, async ({
      page,
    }) => {
      await openGoogleTagSettings(page);
      await choice(page, name).click();
      await page.getByRole("button", { name: SUBMIT }).click();

      await expect(page.getByText(SAVED)).toBeVisible();
      expect(storedConsentMode()).toBe(stored);

      await page.reload();
      await expect(choice(page, name)).toBeChecked();
    });
  }

  test("offers a consent tool only with a Tag Manager container ID", async ({
    page,
  }) => {
    const consentTool = "Handled by my own consent tool in Tag Manager";
    await openGoogleTagSettings(page);
    await expect(choice(page, consentTool)).toBeEnabled();

    await containerId(page).fill("");
    await expect(choice(page, consentTool)).toBeDisabled();
    await expect(
      page.getByText(
        "Enter a Tag Manager container ID to choose this. Your consent tool runs inside the container."
      )
    ).toBeVisible();

    // A consent tool already chosen stays chosen while the ID is cleared, and
    // the save is refused next to the ID.
    await containerId(page).fill(CONTAINER_ID);
    await choice(page, consentTool).click();
    await containerId(page).fill("");
    await expect(choice(page, consentTool)).toBeChecked();
    await page.getByRole("button", { name: SUBMIT }).click();

    await expect(
      page.getByText(
        "Enter a Tag Manager container ID for your consent tool to run in, or choose another option under Reader consent."
      )
    ).toBeVisible();
    expect(storedConsentMode()).toBe("not_required");
  });

  test("warns that the banner has no privacy page until one is named", async ({
    page,
  }) => {
    await openGoogleTagSettings(page);
    await expect(page.getByText(PRIVACY_PAGE_MISSING)).toHaveCount(0);

    await choice(page, "Ask readers first").click();
    await expect(page.getByText(PRIVACY_PAGE_MISSING)).toBeVisible();
    await choice(page, "Not required").click();
    await expect(page.getByText(PRIVACY_PAGE_MISSING)).toHaveCount(0);

    runSql(`
      UPDATE tenant_config SET privacy_page_id = '${PRIVACY_PAGE_ID}'
      WHERE tenant_id = ${TENANT_ID_SQL};
    `);
    await page.reload();
    await choice(page, "Ask readers first").click();
    await expect(choice(page, "Ask readers first")).toBeChecked();
    await expect(page.getByText(PRIVACY_PAGE_MISSING)).toHaveCount(0);
  });
});
