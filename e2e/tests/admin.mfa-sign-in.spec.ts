import type { Browser, Page } from "@playwright/test";
import { expect, test } from "@playwright/test";

import { signInAsAdmin } from "../src/admin";
import { applyScenarioSql } from "../src/db";
import { signInAsSeedPlatformSuperAdmin } from "../src/platform";
import {
  ADMIN_MFA_ADMIN,
  ADMIN_MFA_SCENARIO,
  ADMIN_PASSKEY_ADMIN,
} from "../src/scenarios/admin-mfa";
import { totpCode } from "../src/totp";
import { WEB_ADMIN_BASE_URL } from "../src/urls";
import { addVirtualAuthenticator } from "../src/webauthn";

/**
 * A tenant administrator finishing a login on `/mfa`: first the enrollment the
 * platform requires, then a sign-in with one of the recovery codes that
 * enrollment issued. Both submissions store the session and answer on the
 * same screen, so each has to stay there rather than fall back to `/login`.
 * A second administrator enrolls a passkey instead, from Chromium's virtual
 * authenticator, and answers the next sign-in with it alone.
 *
 * Requiring MFA of tenant administrators is a platform-wide policy that every
 * console sign-in reads, which is why this suite has a project of its own.
 */

const NEXT_PATH = "/series";

const SECURITY_POLICY_PATH = "/policies/security";

const REQUIRE_MFA =
  "Require multi-factor authentication for tenant administrators";

/**
 * Tick or clear the platform's MFA requirement. The server rereads the policy
 * only every few seconds, so a caller that depends on the change waits for it.
 */
const requireMfaOfTenantAdmins = async (
  browser: Browser,
  required: boolean
): Promise<void> => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await signInAsSeedPlatformSuperAdmin(page, SECURITY_POLICY_PATH);

  await page
    .getByRole("checkbox", { exact: true, name: REQUIRE_MFA })
    .setChecked(required);
  await page.getByRole("button", { name: "Save security policy" }).click();
  await expect(page.getByRole("status")).toContainText(
    "Security policy saved."
  );

  await context.close();
};

const signInToMfa = async (
  page: Page,
  admin: { email: string; password: string } = ADMIN_MFA_ADMIN
): Promise<void> => {
  await signInAsAdmin(page, admin, NEXT_PATH);
  await expect(page).toHaveURL(/\/mfa$/u);
};

const expectConsole = async (page: Page): Promise<void> => {
  await expect(page).toHaveURL(new RegExp(`${NEXT_PATH}/?$`, "u"));
  await expect(
    page.getByRole("heading", { exact: true, name: "Series" }).first()
  ).toBeVisible();
};

const recoveryCodes = (page: Page) =>
  page.getByRole("listitem").getByRole("code");

test.describe.configure({ mode: "serial" });

test.beforeAll(async ({ browser }) => {
  applyScenarioSql(ADMIN_MFA_SCENARIO);
  await requireMfaOfTenantAdmins(browser, true);
});

test.afterAll(async ({ browser }) => {
  await requireMfaOfTenantAdmins(browser, false);
  applyScenarioSql(ADMIN_MFA_SCENARIO);
});

test.describe("admin MFA sign-in", () => {
  let recoveryCode = "";

  test("a required enrollment shows the recovery codes and goes on to the console", async ({
    page,
  }) => {
    // Until the server rereads the policy, the password alone signs in.
    await expect(async () => {
      await page.context().clearCookies();
      await signInToMfa(page);
    }).toPass({ intervals: [4000], timeout: 30_000 });

    await page
      .getByRole("button", { name: "Set up an authenticator app" })
      .click();
    const secret = await page.getByText(/^[A-Z2-7]{16,}$/u).textContent();
    await page
      .getByLabel("Verification code")
      .fill(totpCode(secret?.trim() ?? ""));
    await page
      .getByRole("button", { name: "Turn on two-step verification" })
      .click();

    await expect(recoveryCodes(page).first()).toBeVisible();
    await expect(page).toHaveURL(/\/mfa$/u);
    recoveryCode = (await recoveryCodes(page).first().textContent()) ?? "";
    expect(recoveryCode).not.toBe("");

    await page.getByRole("link", { name: "Continue to the console" }).click();
    await expect(page).toHaveURL(new RegExp(`${NEXT_PATH}/?$`, "u"));
    await expect(
      page.getByRole("heading", { exact: true, name: "Series" }).first()
    ).toBeVisible();

    // The codes are shown once: going back does not bring them up again.
    await page.goBack();
    await expect(page).toHaveURL(new RegExp(`${NEXT_PATH}/?$`, "u"));
    await expect(page.getByText(recoveryCode)).toHaveCount(0);
  });

  test("a recovery code sign-in says how many codes are left and goes on to where the login was heading", async ({
    page,
  }) => {
    await signInToMfa(page);

    await page.getByLabel("Verification code").fill(recoveryCode);
    await page.getByRole("button", { name: "Verify" }).click();

    await expect(
      page.getByRole("heading", { name: "Signed in with a recovery code" })
    ).toBeVisible();
    await expect(page.getByText(/^9 recovery codes are left\./u)).toBeVisible();
    await expect(page).toHaveURL(/\/mfa$/u);

    await expect(
      page.getByRole("link", { name: "Continue to the console" })
    ).toHaveAttribute("href", NEXT_PATH);

    // The spent challenge outlives the answer only to render it; opening the
    // screen again has nothing to show and carries on with the login.
    await page.goto(`${WEB_ADMIN_BASE_URL}/mfa`);
    await expect(page).toHaveURL(new RegExp(`${NEXT_PATH}/?$`, "u"));
    await expect(
      page.getByRole("heading", { exact: true, name: "Series" }).first()
    ).toBeVisible();
  });

  test("opening /mfa with no challenge goes to the sign-in screen", async ({
    page,
  }) => {
    await page.goto(`${WEB_ADMIN_BASE_URL}/mfa`);

    await expect(page).toHaveURL(/\/login/u);
  });
});

test.describe("admin passkey sign-in", () => {
  test("a required enrollment registers a passkey, and the passkey alone answers the next sign-in", async ({
    page,
  }) => {
    await addVirtualAuthenticator(page);

    await signInToMfa(page, ADMIN_PASSKEY_ADMIN);
    await page.getByRole("button", { name: "Set up a passkey" }).click();

    await expect(recoveryCodes(page).first()).toBeVisible();
    await expect(page).toHaveURL(/\/mfa$/u);
    await page.getByRole("link", { name: "Continue to the console" }).click();
    await expectConsole(page);

    // Signing out leaves the passkey in the authenticator for the next login.
    await page.context().clearCookies();
    await signInToMfa(page, ADMIN_PASSKEY_ADMIN);

    // The passkey is offered first, and nothing has to be typed.
    await expect(page.getByLabel("Recovery code")).toHaveCount(0);
    await page
      .getByRole("button", { exact: true, name: "Use a passkey" })
      .click();
    await expectConsole(page);
  });

  test("the recovery code form stays one click away from the passkey", async ({
    page,
  }) => {
    await signInToMfa(page, ADMIN_PASSKEY_ADMIN);

    await page
      .getByRole("button", { name: "Enter a recovery code instead" })
      .click();
    await expect(page.getByLabel("Recovery code")).toBeVisible();

    await page.getByRole("button", { name: "Use a passkey instead" }).click();
    await expect(
      page.getByRole("button", { exact: true, name: "Use a passkey" })
    ).toBeVisible();
  });
});
