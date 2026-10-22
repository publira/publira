import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";

import { signInAsAdmin } from "../src/admin";
import { applyScenarioSql, querySql } from "../src/db";
import {
  SIGN_UP_SETTINGS_ADMIN,
  SIGN_UP_SETTINGS_EDITOR,
  SIGN_UP_SETTINGS_SCENARIO,
  SIGN_UP_SETTINGS_TENANT,
} from "../src/scenarios/sign-up-settings";
import {
  storefrontPath,
  WEB_ADMIN_SIGN_UP_SETTINGS_BASE_URL,
  WEB_STOREFRONT_SIGN_UP_SETTINGS_BASE_URL,
} from "../src/urls";

/**
 * A tenant administrator closes reader sign-up from `/settings` with a message
 * of their own, and the tenant's sign-up page shows that message in place of
 * the form until sign-up is opened again.
 */

const SAVE = "Save the sign-up settings";
const SAVED_CLOSED =
  "Sign-up is closed. Visitors see your message in place of the sign-up form.";
const SAVED_OPEN = "Sign-up is open. Visitors can create a reader account.";
const CLOSED_NOTICE =
  /^Sign-up is closed\. Nobody can create a new reader account/u;
const ADMIN_ONLY =
  "Only a tenant administrator can change this setting. You have read-only access.";
const MESSAGE = "We open again in spring.";

const signupUrl = `${WEB_STOREFRONT_SIGN_UP_SETTINGS_BASE_URL}${storefrontPath("/signup")}`;
const loginUrl = `${WEB_STOREFRONT_SIGN_UP_SETTINGS_BASE_URL}${storefrontPath("/login")}`;

const openSwitch = (page: Page) =>
  page.getByRole("switch", { name: "Accept new readers" });

const messageField = (page: Page) =>
  page.getByRole("textbox", { name: "Message while sign-up is closed" });

/** The stored row, as `open|message`, or empty while there is none. */
const storedSetting = (): string =>
  querySql(`
    SELECT s.sign_up_open::text || '|' || s.closed_message
    FROM tenant_sign_up_settings s
    JOIN tenants t ON t.id = s.tenant_id
    WHERE t.public_id = '${SIGN_UP_SETTINGS_TENANT}';
  `);

const openSettings = (
  page: Page,
  account: { email: string; password: string } = SIGN_UP_SETTINGS_ADMIN
) =>
  signInAsAdmin(
    page,
    account,
    "/settings",
    WEB_ADMIN_SIGN_UP_SETTINGS_BASE_URL
  );

// One setting for one tenant, so the tests run in order rather than beside
// each other, and each starts from what the one before it saved.
test.describe.configure({ mode: "serial" });

test.describe("web-admin reader sign-up", () => {
  test.beforeAll(() => {
    applyScenarioSql(SIGN_UP_SETTINGS_SCENARIO);
  });

  test.afterAll(() => {
    applyScenarioSql(SIGN_UP_SETTINGS_SCENARIO);
  });

  test("an administrator closes sign-up with a message, and the site shows it in place of the form", async ({
    page,
  }) => {
    await openSettings(page);

    await expect(openSwitch(page)).toHaveAttribute("aria-checked", "true");
    await expect(page.getByText(CLOSED_NOTICE)).toBeHidden();

    await openSwitch(page).click();
    await messageField(page).fill(`  ${MESSAGE}  `);
    await page.getByRole("button", { name: SAVE }).click();

    await expect(page.getByText(SAVED_CLOSED)).toBeVisible();
    await expect(page.getByText(CLOSED_NOTICE)).toBeVisible();
    expect(storedSetting()).toBe(`false|${MESSAGE}`);

    await page.reload();

    await expect(openSwitch(page)).toHaveAttribute("aria-checked", "false");
    await expect(messageField(page)).toHaveValue(MESSAGE);
    await expect(page.getByText(CLOSED_NOTICE)).toBeVisible();

    await page.goto(signupUrl);

    await expect(
      page.getByRole("heading", { name: "Sign-up is closed" })
    ).toBeVisible();
    await expect(page.getByText(MESSAGE)).toBeVisible();
    await expect(page.getByRole("button", { name: "Sign up" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Sign in" })).toBeVisible();

    await page.goto(loginUrl);

    await expect(page.getByText(MESSAGE)).toBeVisible();
    await expect(page.getByRole("link", { name: "Sign up" })).toHaveCount(0);
  });

  test("a message over the bound is refused on the form", async ({ page }) => {
    await openSettings(page);

    const tooLong = "a".repeat(1001);
    await messageField(page).fill(tooLong);
    await page.getByRole("button", { name: SAVE }).click();

    await expect(
      page.getByText("Keep the message to 1,000 characters or fewer.").first()
    ).toBeVisible();
    await expect(messageField(page)).toHaveValue(tooLong);
    await expect(page.getByText(SAVED_CLOSED)).toBeHidden();
    expect(storedSetting()).toBe(`false|${MESSAGE}`);
  });

  test("an editor sees the closed sign-up read-only", async ({ page }) => {
    await openSettings(page, SIGN_UP_SETTINGS_EDITOR);

    await expect(page.getByText(ADMIN_ONLY).first()).toBeVisible();
    await expect(page.getByText(CLOSED_NOTICE)).toBeVisible();
    await expect(page.getByRole("button", { name: SAVE })).toBeDisabled();
    await expect(openSwitch(page)).toHaveAttribute("aria-checked", "false");
    await expect(openSwitch(page)).toBeDisabled();
    await expect(messageField(page)).toHaveValue(MESSAGE);
    await expect(messageField(page)).toBeDisabled();
  });

  test("an administrator opens sign-up again, and the site offers the form", async ({
    page,
  }) => {
    await openSettings(page);

    await openSwitch(page).click();
    await page.getByRole("button", { name: SAVE }).click();

    await expect(page.getByText(SAVED_OPEN)).toBeVisible();
    await expect(page.getByText(CLOSED_NOTICE)).toBeHidden();
    // The message is kept, so closing sign-up again shows the same text.
    expect(storedSetting()).toBe(`true|${MESSAGE}`);

    await page.reload();

    await expect(openSwitch(page)).toHaveAttribute("aria-checked", "true");

    await page.goto(signupUrl);

    await expect(page.getByRole("button", { name: "Sign up" })).toBeVisible();
    await expect(page.getByText(MESSAGE)).toHaveCount(0);
  });
});
