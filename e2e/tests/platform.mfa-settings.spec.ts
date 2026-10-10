import { expect, test } from "@playwright/test";

import { applyScenarioSql } from "../src/db";
import { signInAsPlatformOperator } from "../src/platform";
import {
  PLATFORM_MFA_SCENARIO,
  PLATFORM_MFA_SETTINGS_OPERATOR,
} from "../src/scenarios/platform-mfa";
import { totpCode } from "../src/totp";

/**
 * A Platform Console operator managing their own two-step verification from
 * `/account`: turning it on, renewing the recovery codes, and turning it off
 * again. The recovery codes are shown only once, so the page the router keeps
 * for Back must not show them again.
 *
 * The scenario switches the platform's requirement off as well, but this
 * suite runs with the parallel ones, before the sign-in suite switches it on.
 */

const ACCOUNT_PATH = "/account";

test.beforeAll(() => {
  applyScenarioSql(PLATFORM_MFA_SCENARIO);
});

test.afterAll(() => {
  applyScenarioSql(PLATFORM_MFA_SCENARIO);
});

test.describe("platform operator MFA account settings", () => {
  test("an operator turns two-step verification on, renews the recovery codes, and turns it off", async ({
    page,
  }) => {
    await signInAsPlatformOperator(
      page,
      PLATFORM_MFA_SETTINGS_OPERATOR,
      ACCOUNT_PATH
    );
    await expect(page).toHaveURL(new RegExp(`${ACCOUNT_PATH}$`, "u"));
    await expect(page.getByText("Two-step verification is off.")).toBeVisible();

    await page.getByRole("button", { exact: true, name: "Set up" }).click();
    const secretText = await page.getByText(/^[A-Z2-7]{16,}$/u).textContent();
    const secret = secretText?.trim() ?? "";
    await page.getByLabel("Verification code").fill(totpCode(secret));
    await page
      .getByRole("button", { name: "Turn on two-step verification" })
      .click();

    await expect(
      page.getByText("Two-step verification is now on.")
    ).toBeVisible();
    const recoveryCodes = page.getByRole("listitem").getByRole("code");
    await expect(recoveryCodes).toHaveCount(10);
    const issued = (await recoveryCodes.first().textContent()) ?? "";
    expect(issued).not.toBe("");

    // The codes are shown once: the page the router brings back on Back has
    // the factor on and nothing it issued.
    await page
      .getByRole("navigation")
      .getByRole("link", { exact: true, name: "Tenants" })
      .click();
    await expect(page).toHaveURL(/\/tenants\/?$/u);
    await page.goBack();
    await expect(page).toHaveURL(new RegExp(`${ACCOUNT_PATH}$`, "u"));
    await expect(page.getByText("Two-step verification is on.")).toBeVisible();
    await expect(page.getByText(issued)).toHaveCount(0);

    // A new batch replaces every code, so the first one issued is gone.
    await page
      .locator("form")
      .filter({ hasText: "Regenerate recovery codes" })
      .getByLabel("Verification code")
      .fill(totpCode(secret, 1));
    await page.getByRole("button", { exact: true, name: "Regenerate" }).click();
    await expect(
      page.getByText("New recovery codes have been issued.")
    ).toBeVisible();
    await expect(recoveryCodes).toHaveCount(10);
    await expect(page.getByText(issued)).toHaveCount(0);
    const renewed = (await recoveryCodes.first().textContent()) ?? "";

    // A recovery code may take the factor off, for an operator whose
    // authenticator is gone.
    await page
      .locator("form")
      .filter({ hasText: "Turn off two-step verification" })
      .getByLabel("Verification code")
      .fill(renewed);
    await page.getByRole("button", { exact: true, name: "Turn off" }).click();
    await expect(
      page.getByText("Two-step verification has been turned off.")
    ).toBeVisible();
    await expect(page.getByText("Two-step verification is off.")).toBeVisible();
  });
});
