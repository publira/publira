import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";

import { signInAsAdmin } from "../src/admin";
import { applyScenarioSql, querySql } from "../src/db";
import {
  PAYMENT_SETTINGS_ADMIN,
  PAYMENT_SETTINGS_SCENARIO,
  PAYMENT_SETTINGS_TENANT,
} from "../src/scenarios/payment-settings";
import { WEB_ADMIN_PAYMENT_SETTINGS_BASE_URL } from "../src/urls";

/**
 * A tenant administrator setting up PAY.JP from the console copy alone:
 * choosing it, storing its two credentials, and turning payments off again.
 */

const PAYMENT_PATH = "/integrations/payment";

const SAVED = "The payment settings were saved.";
const READY =
  "Checkout and the webhook for paid episodes use this tenant's settings.";
const DISABLED =
  "The credentials are stored, but payments are off. Checkout and the webhook do not run.";

const SECRET_KEY_SOURCE =
  "The secret key (sk_live_… or sk_test_…) on the API settings page of the PAY.JP dashboard. A test key takes test payments only.";
const WEBHOOK_TOKEN_SOURCE =
  "The webhook token (whook_…) shown in the account settings of the PAY.JP dashboard.";
const WEBHOOK_NOTE =
  "PAY.JP sends every notification with the webhook token stored above, and one that does not carry it is refused.";

const SECRET_KEY = "sk_test_placeholder";
const WEBHOOK_TOKEN = "whook_example";

const storedSettings = (): string =>
  querySql(`
    SELECT COALESCE((
      SELECT provider || '|' || enabled::text
      FROM tenant_payment_config
      WHERE tenant_id = (
        SELECT id FROM tenants
        WHERE public_id = '${PAYMENT_SETTINGS_TENANT.publicId}'
      )
    ), 'none');
  `);

const paymentsCheckbox = (page: Page) =>
  page.getByRole("checkbox", { name: "Enable payments" });

test.describe.configure({ mode: "serial" });

test.beforeAll(() => {
  applyScenarioSql(PAYMENT_SETTINGS_SCENARIO);
});

test.afterAll(() => {
  applyScenarioSql(PAYMENT_SETTINGS_SCENARIO);
});

test.describe("PAY.JP payment settings", () => {
  test("stores PAY.JP's credentials, is ready, and turns off again", async ({
    page,
  }) => {
    await signInAsAdmin(
      page,
      PAYMENT_SETTINGS_ADMIN,
      PAYMENT_PATH,
      WEB_ADMIN_PAYMENT_SETTINGS_BASE_URL
    );
    await expect(
      page.getByRole("heading", { exact: true, name: "Payment settings" })
    ).toBeVisible();

    const provider = page.getByRole("combobox", { name: "Payment provider" });
    await provider.click();
    await page.getByRole("option", { name: "PAY.JP" }).click();
    await expect(provider).toContainText("PAY.JP");

    await expect(page.getByText(SECRET_KEY_SOURCE)).toBeVisible();
    await expect(page.getByText(WEBHOOK_TOKEN_SOURCE)).toBeVisible();
    await expect(page.getByText(WEBHOOK_NOTE)).toBeVisible();

    await paymentsCheckbox(page).click();
    await page.getByLabel(/^Secret key/u).fill(SECRET_KEY);
    await page.getByLabel(/^Webhook token/u).fill(WEBHOOK_TOKEN);
    await page.getByRole("button", { exact: true, name: "Save" }).click();

    await expect(page.getByText(SAVED)).toBeVisible();
    await expect(page.getByText(READY)).toBeVisible();
    expect(storedSettings()).toBe("payjp|true");

    await paymentsCheckbox(page).click();
    await page.getByRole("button", { exact: true, name: "Save" }).click();

    await expect(page.getByText(DISABLED)).toBeVisible();
    expect(storedSettings()).toBe("payjp|false");
  });
});
