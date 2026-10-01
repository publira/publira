import { expect, test } from "@playwright/test";

import { signInAsAdmin } from "../src/admin";
import { applyScenarioSql } from "../src/db";
import {
  ADMIN_MFA_SETTINGS_ADMIN,
  ADMIN_MFA_SETTINGS_SCENARIO,
} from "../src/scenarios/admin-mfa-settings";
import { totpCode } from "../src/totp";

/**
 * A tenant administrator turning on their own two-step verification from
 * `/settings/account`. The recovery codes that enrollment issues are shown
 * only once, so the page the router keeps for Back must not show them again.
 */

const ACCOUNT_SETTINGS_PATH = "/settings/account";

test.beforeAll(() => {
  applyScenarioSql(ADMIN_MFA_SETTINGS_SCENARIO);
});

test.afterAll(() => {
  applyScenarioSql(ADMIN_MFA_SETTINGS_SCENARIO);
});

test.describe("admin MFA account settings", () => {
  test("the recovery codes an enrollment issued are not shown again on Back", async ({
    page,
  }) => {
    await signInAsAdmin(page, ADMIN_MFA_SETTINGS_ADMIN, ACCOUNT_SETTINGS_PATH);
    await expect(page).toHaveURL(new RegExp(`${ACCOUNT_SETTINGS_PATH}$`, "u"));

    await page.getByRole("button", { exact: true, name: "Set up" }).click();
    const secret = await page.getByText(/^[A-Z2-7]{16,}$/u).textContent();
    await page
      .getByLabel("Verification code")
      .fill(totpCode(secret?.trim() ?? ""));
    await page
      .getByRole("button", { name: "Turn on two-step verification" })
      .click();

    await expect(
      page.getByText("Two-step verification is now on.")
    ).toBeVisible();
    const recoveryCodes = page.getByRole("listitem").getByRole("code");
    await expect(recoveryCodes).toHaveCount(10);
    const recoveryCode = (await recoveryCodes.first().textContent()) ?? "";
    expect(recoveryCode).not.toBe("");

    await page
      .getByRole("navigation")
      .getByRole("link", { exact: true, name: "Series" })
      .click();
    await expect(page).toHaveURL(/\/series\/?$/u);
    await expect(
      page.getByRole("heading", { exact: true, name: "Series" }).first()
    ).toBeVisible();

    await page.goBack();
    await expect(page).toHaveURL(new RegExp(`${ACCOUNT_SETTINGS_PATH}$`, "u"));
    // The page is back on screen, with the factor on and nothing it issued.
    await expect(
      page.getByRole("button", { exact: true, name: "Regenerate" })
    ).toBeVisible();
    await expect(page.getByText(recoveryCode)).toHaveCount(0);
    await expect(
      page.getByText("Two-step verification is now on.")
    ).toHaveCount(0);
  });
});
