import { generateKeyPairSync } from "node:crypto";

import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";

import { signInAsAdmin } from "../src/admin";
import { applyScenarioSql, querySql } from "../src/db";
import {
  MOBILE_PUSH_ADMIN,
  MOBILE_PUSH_SCENARIO,
  MOBILE_PUSH_TENANT,
} from "../src/scenarios/mobile-push";
import { WEB_ADMIN_MOBILE_PUSH_BASE_URL } from "../src/urls";

/**
 * A tenant administrator connecting the Firebase project their mobile app is
 * built with, replacing its key, and disconnecting it again.
 */

const MOBILE_PUSH_PATH = "/integrations/mobile-push";
const PROJECT_ID = "publira-e2e";

const UNCONFIGURED = "Mobile push is off.";
const CONFIGURED = "Mobile push is on.";
const SAVED = "The Firebase credentials were saved.";

const FIRST_ACCOUNT = `first-sender@${PROJECT_ID}.iam.gserviceaccount.com`;
const SECOND_ACCOUNT = `second-sender@${PROJECT_ID}.iam.gserviceaccount.com`;

// Generated per run: a real RSA key is what the server accepts, and one that
// never leaves this process is not a secret to commit.
const privateKeyPem = (): string =>
  generateKeyPairSync("rsa", {
    modulusLength: 2048,
    privateKeyEncoding: { format: "pem", type: "pkcs8" },
    publicKeyEncoding: { format: "pem", type: "spki" },
  }).privateKey;

const FIRST_KEY = privateKeyPem();
const SECOND_KEY = privateKeyPem();

const serviceAccountKey = (
  clientEmail: string,
  privateKey: string,
  projectId = PROJECT_ID
): string =>
  JSON.stringify({
    client_email: clientEmail,
    private_key: privateKey,
    project_id: projectId,
    token_uri: "https://oauth2.googleapis.com/token",
    type: "service_account",
  });

const storedCredentials = (): string =>
  querySql(`
    SELECT COALESCE((
      SELECT client_email || '|' || service_account_json_encrypted
      FROM tenant_fcm_config
      WHERE tenant_id = (
        SELECT id FROM tenants
        WHERE public_id = '${MOBILE_PUSH_TENANT.publicId}'
      )
    ), 'none');
  `);

const openMobilePushSettings = async (page: Page): Promise<void> => {
  await page.goto(`${WEB_ADMIN_MOBILE_PUSH_BASE_URL}${MOBILE_PUSH_PATH}`);
  await expect(
    page.getByRole("heading", { name: "Firebase Cloud Messaging" })
  ).toBeVisible();
};

const uploadKey = async (
  page: Page,
  projectId: string,
  keyJson: string
): Promise<void> => {
  await page.getByLabel("Firebase project ID").fill(projectId);
  await page.getByLabel("Service account key file").setInputFiles({
    buffer: Buffer.from(keyJson),
    mimeType: "application/json",
    name: "service-account.json",
  });
};

test.describe.configure({ mode: "serial" });

test.beforeAll(() => {
  applyScenarioSql(MOBILE_PUSH_SCENARIO);
});

test.afterAll(() => {
  applyScenarioSql(MOBILE_PUSH_SCENARIO);
});

test.describe("mobile push credentials", () => {
  test.beforeEach(async ({ page }) => {
    await signInAsAdmin(
      page,
      MOBILE_PUSH_ADMIN,
      MOBILE_PUSH_PATH,
      WEB_ADMIN_MOBILE_PUSH_BASE_URL
    );
  });

  test("adds credentials and shows them only as present", async ({ page }) => {
    await openMobilePushSettings(page);
    await expect(page.getByText(UNCONFIGURED)).toBeVisible();

    await uploadKey(
      page,
      PROJECT_ID,
      serviceAccountKey(FIRST_ACCOUNT, FIRST_KEY)
    );
    await page.getByRole("button", { name: "Save the credentials" }).click();

    await expect(page.getByText(SAVED)).toBeVisible();
    await expect(page.getByText(CONFIGURED)).toBeVisible();
    await expect(page.getByText(FIRST_ACCOUNT)).toBeVisible();

    const [clientEmail, sealed] = storedCredentials().split("|");
    expect(clientEmail).toBe(FIRST_ACCOUNT);
    expect(sealed).toMatch(/^enc:/u);

    await page.reload();
    await expect(page.getByText(FIRST_ACCOUNT)).toBeVisible();
    expect(await page.content()).not.toContain("PRIVATE KEY");
  });

  test("refuses a file that is not a key or belongs to another project", async ({
    page,
  }) => {
    await openMobilePushSettings(page);

    await uploadKey(page, PROJECT_ID, "not json");
    await page.getByRole("button", { name: "Replace the credentials" }).click();
    await expect(
      page.getByText(
        "That file is not JSON. Select the service account key file Firebase downloaded."
      )
    ).toBeVisible();

    await uploadKey(
      page,
      PROJECT_ID,
      serviceAccountKey(SECOND_ACCOUNT, SECOND_KEY, "another-project")
    );
    await page.getByRole("button", { name: "Replace the credentials" }).click();
    await expect(
      page.getByText(
        `The key belongs to the Firebase project "another-project", not "${PROJECT_ID}".`
      )
    ).toBeVisible();
    expect(await page.content()).not.toContain("PRIVATE KEY");

    expect(storedCredentials().split("|")[0]).toBe(FIRST_ACCOUNT);
  });

  test("replaces the stored credentials", async ({ page }) => {
    await openMobilePushSettings(page);
    const before = storedCredentials();

    await uploadKey(
      page,
      PROJECT_ID,
      serviceAccountKey(SECOND_ACCOUNT, SECOND_KEY)
    );
    await page.getByRole("button", { name: "Replace the credentials" }).click();

    await expect(page.getByText(SAVED)).toBeVisible();
    await expect(page.getByText(SECOND_ACCOUNT)).toBeVisible();
    await expect(page.getByText(FIRST_ACCOUNT)).toHaveCount(0);

    const after = storedCredentials();
    expect(after.split("|")[0]).toBe(SECOND_ACCOUNT);
    expect(after).not.toBe(before);
  });

  test("removes the credentials", async ({ page }) => {
    await openMobilePushSettings(page);

    await page.getByRole("button", { name: "Remove" }).click();
    await page
      .getByRole("alertdialog")
      .getByRole("button", { name: "Remove the credentials" })
      .click();

    await expect(page.getByText(UNCONFIGURED)).toBeVisible();
    await expect(page.getByText(SECOND_ACCOUNT)).toHaveCount(0);
    expect(storedCredentials()).toBe("none");
  });
});
