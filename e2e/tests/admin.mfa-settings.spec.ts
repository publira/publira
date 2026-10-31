import { expect, test } from "@playwright/test";

import { signInAsAdmin } from "../src/admin";
import { applyScenarioSql } from "../src/db";
import {
  ADMIN_MFA_SETTINGS_ADMIN,
  ADMIN_MFA_SETTINGS_SCENARIO,
} from "../src/scenarios/admin-mfa-settings";
import { totpCode } from "../src/totp";
import { addVirtualAuthenticator } from "../src/webauthn";

/**
 * A tenant administrator turning on their own two-step verification from
 * `/settings/account`. The recovery codes that enrollment issues are shown
 * only once, so the page the router keeps for Back must not show them again.
 * The same administrator, put back to a password alone, then adds a passkey
 * there instead, from Chromium's virtual authenticator, answers the next
 * sign-in with it, and removes it. With that passkey as their only factor,
 * they replace their recovery codes with it, and an assertion the console
 * refuses replaces none.
 *
 * Both use the one account the scenario keeps for this screen, since the
 * documentation photographs the member and reader lists with it in them, so
 * the tests run in order rather than beside each other.
 */

const ACCOUNT_SETTINGS_PATH = "/settings/account";

test.describe.configure({ mode: "serial" });

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

test.describe("admin passkey account settings", () => {
  test("a passkey added from the account settings answers the next sign-in and is removed again", async ({
    page,
  }) => {
    // The test before this one left an authenticator app on the account.
    applyScenarioSql(ADMIN_MFA_SETTINGS_SCENARIO);
    await addVirtualAuthenticator(page);
    await signInAsAdmin(page, ADMIN_MFA_SETTINGS_ADMIN, ACCOUNT_SETTINGS_PATH);
    await expect(page).toHaveURL(new RegExp(`${ACCOUNT_SETTINGS_PATH}$`, "u"));
    await expect(page.getByText("No passkeys are registered.")).toBeVisible();

    await page.getByRole("button", { name: "Add a passkey" }).click();

    // The account held no factor, so the passkey brings the recovery codes.
    await expect(page.getByText("The passkey has been added.")).toBeVisible();
    await expect(page.getByRole("listitem").getByRole("code")).toHaveCount(10);
    await expect(
      page.getByText("Two-step verification is on with a passkey.")
    ).toBeVisible();

    await page.getByLabel("Name", { exact: true }).fill("E2E authenticator");
    await page.getByRole("button", { exact: true, name: "Save" }).click();

    const passkey = page
      .getByRole("listitem")
      .filter({ hasText: "E2E authenticator" });

    await expect(passkey).toContainText("Not used yet");

    // Signing out leaves the passkey in the authenticator, and the next
    // sign-in stops for it.
    await page.context().clearCookies();
    await signInAsAdmin(page, ADMIN_MFA_SETTINGS_ADMIN, ACCOUNT_SETTINGS_PATH);
    await expect(page).toHaveURL(/\/mfa$/u);
    await page
      .getByRole("button", { exact: true, name: "Use a passkey" })
      .click();
    await expect(page).toHaveURL(new RegExp(`${ACCOUNT_SETTINGS_PATH}$`, "u"));
    await expect(passkey).toContainText("Last used");

    await passkey.getByRole("button", { exact: true, name: "Remove" }).click();
    await page
      .getByRole("alertdialog")
      .getByRole("button", { exact: true, name: "Remove" })
      .click();

    await expect(page.getByText("No passkeys are registered.")).toBeVisible();
    await expect(page.getByText("Two-step verification is off.")).toBeVisible();

    // With the passkey gone, the password alone signs in again.
    await page.context().clearCookies();
    await signInAsAdmin(page, ADMIN_MFA_SETTINGS_ADMIN, ACCOUNT_SETTINGS_PATH);
    await expect(page).toHaveURL(new RegExp(`${ACCOUNT_SETTINGS_PATH}$`, "u"));
  });
  test("a passkey replaces the recovery codes of an account with no authenticator app, and a refused one replaces none", async ({
    page,
  }) => {
    applyScenarioSql(ADMIN_MFA_SETTINGS_SCENARIO);
    const authenticator = await addVirtualAuthenticator(page);
    await signInAsAdmin(page, ADMIN_MFA_SETTINGS_ADMIN, ACCOUNT_SETTINGS_PATH);
    await expect(page).toHaveURL(new RegExp(`${ACCOUNT_SETTINGS_PATH}$`, "u"));

    await page.getByRole("button", { name: "Add a passkey" }).click();
    const recoveryCodes = page.getByRole("listitem").getByRole("code");
    await expect(recoveryCodes).toHaveCount(10);
    const firstBatch = await recoveryCodes.allTextContents();
    await page.getByRole("button", { exact: true, name: "Skip" }).click();

    // The account has no authenticator app, so the passkey is what asks for
    // a new batch.
    await expect(
      page.getByRole("button", { exact: true, name: "Regenerate" })
    ).toHaveCount(0);

    const regenerate = page.getByRole("button", {
      name: "Regenerate with a passkey",
    });

    await regenerate.click();

    await expect(
      page.getByText("New recovery codes have been issued.")
    ).toBeVisible();
    await expect(recoveryCodes).toHaveCount(10);
    await expect(recoveryCodes.first()).not.toHaveText(firstBatch[0] ?? "");
    const secondBatch = await recoveryCodes.allTextContents();
    expect(secondBatch).not.toEqual(firstBatch);
    await expect(page.getByText("10 recovery codes left")).toBeVisible();

    // A copy of the authenticator answers with a counter the console has
    // already seen, and the console refuses it.
    await authenticator.rewindSignCounts();
    await regenerate.click();

    await expect(
      page.getByText(
        "That passkey was not accepted. Use a passkey registered to this account."
      )
    ).toBeVisible();
    await expect(recoveryCodes).toHaveText(secondBatch);

    // The batch on screen is still the one the account holds: one of its
    // codes answers the next sign-in.
    await page.context().clearCookies();
    await signInAsAdmin(page, ADMIN_MFA_SETTINGS_ADMIN, ACCOUNT_SETTINGS_PATH);
    await expect(page).toHaveURL(/\/mfa$/u);
    await page
      .getByRole("button", { name: "Enter a recovery code instead" })
      .click();
    await page.getByLabel("Recovery code").fill(secondBatch[0] ?? "");
    await page.getByRole("button", { name: "Verify" }).click();
    await expect(
      page.getByRole("heading", { name: "Signed in with a recovery code" })
    ).toBeVisible();
    await expect(page.getByText(/^9 recovery codes are left\./u)).toBeVisible();
  });
});
