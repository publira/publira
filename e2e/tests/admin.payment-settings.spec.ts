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
 * choosing it, storing its two credentials, and turning payments off again;
 * and choosing the amounts readers may tip the Authors of an episode in.
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

/** The stored tips, as `enabled|amounts`. */
const storedTips = (): string =>
  querySql(`
    SELECT COALESCE((
      SELECT tips_enabled::text || '|' || array_to_string(tip_amounts, ',')
      FROM tenant_config
      WHERE tenant_id = (
        SELECT id FROM tenants
        WHERE public_id = '${PAYMENT_SETTINGS_TENANT.publicId}'
      )
    ), 'none');
  `);

const TIP_SAVE = "Save tip settings";

const TIP_SAVED = "The tip settings were saved.";

/** The Tips card's form, which holds its fields, its notices, and its button. */
const tipsCard = (page: Page) =>
  page
    .locator("form")
    .filter({ has: page.getByRole("button", { name: TIP_SAVE }) });

const tipAmount = (page: Page, position: number) =>
  tipsCard(page).getByRole("spinbutton", {
    exact: true,
    name: `Tip amount ${position}`,
  });

/** The amounts the card shows, in order. */
const tipAmountValues = (page: Page) =>
  tipsCard(page)
    .getByRole("spinbutton", { name: /^Tip amount \d+$/u })
    .evaluateAll((fields: HTMLInputElement[]) =>
      fields.map((field) => field.value)
    );

/**
 * Pastes one amount a line into the first field, which spreads them over a
 * field each, the way a browser dispatches a paste from the clipboard: a
 * headless page cannot be given clipboard access without a grant.
 */
const pasteTipAmounts = (page: Page, amounts: readonly string[]) =>
  tipAmount(page, 1).evaluate((field, pasted) => {
    const clipboardData = new DataTransfer();
    clipboardData.setData("text/plain", pasted);
    field.dispatchEvent(
      new ClipboardEvent("paste", {
        bubbles: true,
        cancelable: true,
        clipboardData,
      })
    );
  }, amounts.join("\n"));

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

test.describe("tips", () => {
  test("saves the amounts in ascending order and lists a store product for each", async ({
    page,
  }) => {
    await signInAsAdmin(
      page,
      PAYMENT_SETTINGS_ADMIN,
      PAYMENT_PATH,
      WEB_ADMIN_PAYMENT_SETTINGS_BASE_URL
    );

    await tipsCard(page)
      .getByRole("switch", { name: "Take tips for Authors" })
      .click();
    await pasteTipAmounts(page, ["1000", "100"]);
    await tipsCard(page).getByRole("button", { name: "Add an amount" }).click();
    await tipAmount(page, 3).fill("300");
    await tipsCard(page).getByRole("button", { name: TIP_SAVE }).click();

    await expect(page.getByText(TIP_SAVED)).toBeVisible();
    expect(storedTips()).toBe("true|100,300,1000");

    await page.reload();

    await expect(
      tipsCard(page).getByRole("switch", { name: "Take tips for Authors" })
    ).toBeChecked();
    expect(await tipAmountValues(page)).toEqual(["100", "300", "1000"]);

    const products = page
      .getByRole("table")
      .filter({ has: page.getByText("Product ID", { exact: true }) });

    await expect(
      products.getByRole("row").filter({ hasText: /^tip_/u })
    ).toHaveText([/^tip_100.*Tip/u, /^tip_300.*Tip/u, /^tip_1000.*Tip/u]);

    const entry = page
      .getByRole("row")
      .filter({ hasText: "Tip settings updated" });

    await expect(async () => {
      await page.goto(
        new URL("/audit-logs", WEB_ADMIN_PAYMENT_SETTINGS_BASE_URL).toString()
      );
      await expect(entry.first()).toBeVisible({ timeout: 5000 });
    }).toPass({ timeout: 30_000 });
    await expect(entry.first()).toContainText(PAYMENT_SETTINGS_ADMIN.name);
  });

  test.describe("refused on the form", () => {
    // From the tips off with one empty field, whatever the test before stored.
    test.beforeEach(() => {
      applyScenarioSql(PAYMENT_SETTINGS_SCENARIO);
    });

    for (const [name, amounts, message] of [
      [
        "a seventh amount",
        ["100", "200", "300", "400", "500", "600", "700"],
        "Enter at most 6 tip amounts.",
      ],
      [
        "a duplicate",
        ["100", "300", "100"],
        '"100" is entered more than once in Tip amounts.',
      ],
      [
        "0",
        ["300", "0"],
        'Enter each tip amount as an amount above 0. "0" is not one.',
      ],
    ] as const) {
      test(name, async ({ page }) => {
        await signInAsAdmin(
          page,
          PAYMENT_SETTINGS_ADMIN,
          PAYMENT_PATH,
          WEB_ADMIN_PAYMENT_SETTINGS_BASE_URL
        );

        await pasteTipAmounts(page, amounts);
        await tipsCard(page).getByRole("button", { name: TIP_SAVE }).click();

        await expect(
          tipsCard(page).getByText(message, { exact: true }).first()
        ).toBeVisible();
        await expect(page.getByText(TIP_SAVED)).toBeHidden();
        expect(storedTips()).toMatch(/^(?:none|false\|)$/u);
      });
    }
  });
});
