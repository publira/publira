import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";

import { querySql, quoteSqlLiteral, runSql } from "../src/db";
import { signInAsSeedPlatformSuperAdmin } from "../src/platform";

const STORAGE_PATH = "/settings/storage";

/**
 * The store the stack runs against, as `scripts/lib.sh` exports it. Every
 * value the suite saves keeps addressing this bucket, so an upload another
 * project makes after this one still lands somewhere.
 */
const BUCKET = process.env.PUBLIRA_S3_BUCKET?.trim() || "publira";
const REGION = process.env.AWS_REGION?.trim() || "us-east-1";
const ENDPOINT =
  process.env.PUBLIRA_S3_ENDPOINT?.trim() || "http://127.0.0.1:9003";
const ACCESS_KEY_ID = process.env.AWS_ACCESS_KEY_ID?.trim() || "publira";
const SECRET_ACCESS_KEY =
  process.env.AWS_SECRET_ACCESS_KEY?.trim() || "publirapass";

const WRONG_SECRET_ACCESS_KEY = "e2e-wrong-secret-access-key";

const SAVED_MESSAGE = "Storage settings saved.";
const UNCONFIGURED_MESSAGE = /Object storage isn't configured yet/u;
const TEST_SUCCEEDED_MESSAGE =
  "The connection works. Publira can upload, read, list, and delete objects in this bucket.";
const TEST_FAILED_MESSAGE =
  "The connection test failed. The steps below show where.";
const SECRET_STORED = "Saved (hidden)";

const storedRow = (): string =>
  querySql(`SELECT row_to_json(c) FROM platform_storage_config c;`);

const storedSecretCiphertext = (): string =>
  querySql(`
    SELECT COALESCE(secret_access_key_encrypted, '')
    FROM platform_storage_config;
  `);

const storedColumn = (column: "access_key_id" | "public_base_url"): string =>
  querySql(`SELECT COALESCE(${column}, '') FROM platform_storage_config;`);

/**
 * Put back the row `task e2e:db` saved. The revision moves past whatever the
 * suite left, so every running server rebuilds its client from it.
 */
const restoreRow = (snapshot: string): void => {
  const revision = Number(
    querySql(
      `SELECT COALESCE(MAX(revision), 0) FROM platform_storage_config;`
    ) || "0"
  );
  runSql(`
    DELETE FROM platform_storage_config;
    INSERT INTO platform_storage_config
    SELECT * FROM json_populate_record(
      NULL::platform_storage_config,
      ${quoteSqlLiteral(snapshot)}::json
    );
    UPDATE platform_storage_config
    SET revision = ${revision + 1}, updated_at = NOW();
  `);
};

const openStorageSettings = async (page: Page): Promise<void> => {
  await signInAsSeedPlatformSuperAdmin(page, STORAGE_PATH);
  await expect(
    page.getByRole("heading", { name: "Object storage" })
  ).toBeVisible();
};

const save = async (page: Page): Promise<void> => {
  await page.getByRole("button", { name: "Save storage settings" }).click();
  await expect(page.getByText(SAVED_MESSAGE)).toBeVisible();
};

const testConnection = async (page: Page): Promise<void> => {
  await page.getByRole("button", { name: "Test connection" }).click();
};

const checkList = (page: Page) =>
  page.getByRole("list", { name: "Connection test steps" });

/**
 * The Platform Console's storage settings: the single S3-compatible store every
 * upload and every image read goes to.
 *
 * The row is one for the whole installation, which is why this suite has a
 * project of its own after the parallel ones. It snapshots the row `task
 * e2e:db` saved and puts it back afterwards, and every value it saves in
 * between still addresses the stack's own bucket.
 */
test.describe("web-platform storage settings", () => {
  test.describe.configure({ mode: "serial" });

  let snapshot = "";

  test.beforeAll(() => {
    snapshot = storedRow();
  });

  test.afterAll(() => {
    if (snapshot) {
      restoreRow(snapshot);
    }
  });

  test("an unconfigured platform says so, and a save is read back", async ({
    page,
  }) => {
    runSql(`DELETE FROM platform_storage_config;`);

    await openStorageSettings(page);
    await expect(page.getByText(UNCONFIGURED_MESSAGE)).toBeVisible();

    await page.getByRole("textbox", { name: /^Bucket/u }).fill(BUCKET);
    await page.getByRole("textbox", { name: /^Region/u }).fill(REGION);
    await page.getByRole("textbox", { name: /^Endpoint/u }).fill(ENDPOINT);
    await page
      .getByRole("checkbox", { name: "Use path-style addressing" })
      .check();
    await expect(
      page.getByRole("radio", { name: /^Use each server's own credentials/u })
    ).toBeChecked();
    await save(page);

    await page.reload();
    await expect(page.getByText(UNCONFIGURED_MESSAGE)).toHaveCount(0);
    await expect(page.getByRole("textbox", { name: /^Bucket/u })).toHaveValue(
      BUCKET
    );
    await expect(page.getByRole("textbox", { name: /^Region/u })).toHaveValue(
      REGION
    );
    await expect(page.getByRole("textbox", { name: /^Endpoint/u })).toHaveValue(
      ENDPOINT
    );
    await expect(
      page.getByRole("checkbox", { name: "Use path-style addressing" })
    ).toBeChecked();
  });

  test("a connection test reports every operation the saved store passed", async ({
    page,
  }) => {
    await openStorageSettings(page);
    await testConnection(page);

    await expect(page.getByText(TEST_SUCCEEDED_MESSAGE)).toBeVisible();
    await expect(checkList(page).getByRole("listitem")).toHaveText([
      /^Upload: Passed/u,
      /^Read back: Passed/u,
      /^List: Passed/u,
      /^Delete: Passed/u,
    ]);
  });

  test("a rejected access key is reported as an authentication failure without echoing it", async ({
    page,
  }) => {
    await openStorageSettings(page);
    await page.getByRole("radio", { name: /^Use an access key/u }).check();
    await page
      .getByRole("textbox", { name: /^Access key ID/u })
      .fill(ACCESS_KEY_ID);
    await page.getByLabel(/^Secret access key/u).fill(WRONG_SECRET_ACCESS_KEY);
    await testConnection(page);

    await expect(page.getByText(TEST_FAILED_MESSAGE)).toBeVisible();
    const checks = checkList(page).getByRole("listitem");
    await expect(checks.first()).toContainText("Upload: Failed");
    await expect(checks.first()).toContainText(/Authentication failed/u);
    await expect(checks.nth(1)).toContainText("Read back: Not run");
    await expect(checkList(page)).not.toContainText(WRONG_SECRET_ACCESS_KEY);

    // A test saves nothing, so the stored store still signs with the ambient
    // credential.
    expect(storedColumn("access_key_id")).toBe("");
  });

  test("replacing the access key stores the secret encrypted and never shows it again", async ({
    page,
  }) => {
    await openStorageSettings(page);
    await page.getByRole("radio", { name: /^Use an access key/u }).check();
    await page
      .getByRole("textbox", { name: /^Access key ID/u })
      .fill(ACCESS_KEY_ID);
    await page.getByLabel(/^Secret access key/u).fill(SECRET_ACCESS_KEY);
    await save(page);

    const ciphertext = storedSecretCiphertext();
    expect(ciphertext).not.toBe("");
    expect(ciphertext).not.toContain(SECRET_ACCESS_KEY);
    expect(storedColumn("access_key_id")).toBe(ACCESS_KEY_ID);

    await page.reload();
    await expect(page.getByText(SECRET_STORED)).toBeVisible();
    await expect(
      page.getByRole("textbox", { name: /^Access key ID/u })
    ).toHaveValue(ACCESS_KEY_ID);
    await expect(page.getByLabel(/^Secret access key/u)).toHaveCount(0);
    expect(await page.content()).not.toContain(SECRET_ACCESS_KEY);
  });

  test("a save that leaves the credential alone keeps the stored secret", async ({
    page,
  }) => {
    const ciphertext = storedSecretCiphertext();
    const publicBaseUrl = `${ENDPOINT}/${BUCKET}`;

    await openStorageSettings(page);
    await page
      .getByRole("textbox", { name: /^Public base URL/u })
      .fill(publicBaseUrl);
    await save(page);

    expect(storedSecretCiphertext()).toBe(ciphertext);
    expect(storedColumn("public_base_url")).toBe(publicBaseUrl);

    await page.reload();
    await expect(
      page.getByRole("textbox", { name: /^Public base URL/u })
    ).toHaveValue(publicBaseUrl);
    await expect(page.getByText(SECRET_STORED)).toBeVisible();

    // The test signs with the stored secret, which is what proves the save
    // kept a usable one rather than an empty column.
    await testConnection(page);
    await expect(page.getByText(TEST_SUCCEEDED_MESSAGE)).toBeVisible();
  });

  test("starting a replacement and undoing it keeps the stored key", async ({
    page,
  }) => {
    const ciphertext = storedSecretCiphertext();

    await openStorageSettings(page);
    await page.getByRole("button", { name: "Replace access key" }).click();
    await expect(page.getByLabel(/^Secret access key/u)).toBeVisible();
    await page.getByRole("button", { name: "Keep saved access key" }).click();
    await expect(page.getByText(SECRET_STORED)).toBeVisible();
    await save(page);

    expect(storedSecretCiphertext()).toBe(ciphertext);
  });
});
