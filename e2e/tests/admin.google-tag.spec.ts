import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";

import { signInAsAdmin } from "../src/admin";
import { applyScenarioSql, querySql } from "../src/db";
import {
  GOOGLE_TAG_ADMIN,
  GOOGLE_TAG_SCENARIO,
  GOOGLE_TAG_TENANT,
} from "../src/scenarios/google-tag";
import { WEB_ADMIN_GOOGLE_TAG_BASE_URL } from "../src/urls";

/**
 * A tenant administrator entering the Google tag their site loads, in each of
 * the three places it can be loaded from, and regenerating the gateway path.
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
const servingMode = (page: Page, name: string) =>
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
    await expect(servingMode(page, "Google")).toBeChecked();
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
    await expect(servingMode(page, "Google")).toBeChecked();
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

    await servingMode(page, "Server container").click();
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
    await expect(servingMode(page, "Server container")).toBeChecked();
    await expect(serverContainerUrl(page)).toHaveValue(SERVER_CONTAINER_URL);
  });

  test("saves the gateway, which generates a path to register and regenerate", async ({
    page,
  }) => {
    await openGoogleTagSettings(page);

    await servingMode(page, "Google tag gateway").click();
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
    await expect(servingMode(page, "Google tag gateway")).toBeChecked();
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
});
