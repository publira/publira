import type { Browser, Page } from "@playwright/test";
import { expect, test } from "@playwright/test";

import { applyScenarioSql } from "../src/db";
import {
  signInAsPlatformOperator,
  signInAsSeedPlatformSuperAdmin,
} from "../src/platform";
import {
  PLATFORM_MFA_OPERATOR,
  PLATFORM_MFA_SCENARIO,
} from "../src/scenarios/platform-mfa";
import { totpCode } from "../src/totp";
import { WEB_PLATFORM_BASE_URL } from "../src/urls";

/**
 * A Platform Console operator finishing a sign-in on `/mfa`: first the
 * enrollment the platform requires of every operator, then a sign-in with a
 * code from the authenticator, then one with a recovery code that enrollment
 * issued.
 *
 * Requiring two-step verification of operators holds every Platform Console
 * sign-in, which is why this suite has a project of its own. Once it is on,
 * no operator can sign in to switch it off without enrolling first, so the
 * scenario file switches it off on teardown instead of the console.
 */

const NEXT_PATH = "/tenants";

const SECURITY_POLICY_PATH = "/policies/security";

const REQUIRE_OPERATOR_MFA =
  "Require two-step verification for every Platform Console operator";

const requireMfaOfOperators = async (browser: Browser): Promise<void> => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await signInAsSeedPlatformSuperAdmin(page, SECURITY_POLICY_PATH);

  await page
    .getByRole("checkbox", { exact: true, name: REQUIRE_OPERATOR_MFA })
    .setChecked(true);
  await page.getByRole("button", { name: "Save security policy" }).click();
  await expect(page.getByRole("status")).toContainText(
    "Security policy saved."
  );

  // The saved policy is what the page reads back, ticked.
  await page.reload();
  await expect(
    page.getByRole("checkbox", { exact: true, name: REQUIRE_OPERATOR_MFA })
  ).toBeChecked();

  await context.close();
};

const signInToMfa = async (page: Page): Promise<void> => {
  await signInAsPlatformOperator(page, PLATFORM_MFA_OPERATOR, NEXT_PATH);
  await expect(page).toHaveURL(/\/mfa$/u);
};

const recoveryCodes = (page: Page) =>
  page.getByRole("listitem").getByRole("code");

const tenantsHeading = (page: Page) =>
  page.getByRole("heading", { exact: true, name: "Tenants" }).first();

test.describe.configure({ mode: "serial" });

test.beforeAll(async ({ browser }) => {
  applyScenarioSql(PLATFORM_MFA_SCENARIO);
  await requireMfaOfOperators(browser);
});

test.afterAll(() => {
  applyScenarioSql(PLATFORM_MFA_SCENARIO);
});

test.describe("platform operator MFA sign-in", () => {
  let secret = "";
  let recoveryCode = "";

  test("a required enrollment shows the recovery codes and goes on to the console", async ({
    page,
  }) => {
    await signInToMfa(page);

    await expect(
      page.getByRole("heading", { name: "Set up two-step verification" })
    ).toBeVisible();
    await page.getByRole("button", { name: "Start setup" }).click();
    const secretText = await page.getByText(/^[A-Z2-7]{16,}$/u).textContent();
    secret = secretText?.trim() ?? "";
    expect(secret).not.toBe("");
    await page.getByLabel("Verification code").fill(totpCode(secret));
    await page
      .getByRole("button", { name: "Turn on two-step verification" })
      .click();

    await expect(recoveryCodes(page)).toHaveCount(10);
    await expect(page).toHaveURL(/\/mfa$/u);
    recoveryCode = (await recoveryCodes(page).first().textContent()) ?? "";
    expect(recoveryCode).not.toBe("");

    await page
      .getByRole("link", { name: "Continue to the Platform Console" })
      .click();
    await expect(page).toHaveURL(new RegExp(`${NEXT_PATH}/?$`, "u"));
    await expect(tenantsHeading(page)).toBeVisible();

    // The codes are shown once: going back does not bring them up again.
    await page.goBack();
    await expect(page).toHaveURL(new RegExp(`${NEXT_PATH}/?$`, "u"));
    await expect(page.getByText(recoveryCode)).toHaveCount(0);
  });

  test("a code from the authenticator finishes the sign-in", async ({
    page,
  }) => {
    await signInToMfa(page);

    // A wrong code keeps the operator on the screen to try again.
    await page.getByLabel("Verification code").fill("000000");
    await page.getByRole("button", { name: "Verify" }).click();
    await expect(
      page.getByText(
        "The code is incorrect. Check your authenticator app and try again."
      )
    ).toBeVisible();
    await expect(page).toHaveURL(/\/mfa$/u);

    // The enrollment spent the current step, and a step is accepted once, so
    // this sign-in presents the next one.
    await page.getByLabel("Verification code").fill(totpCode(secret, 1));
    await page.getByRole("button", { name: "Verify" }).click();

    await expect(page).toHaveURL(new RegExp(`${NEXT_PATH}/?$`, "u"));
    await expect(tenantsHeading(page)).toBeVisible();
  });

  test("a recovery code sign-in says how many codes are left and goes on to where the sign-in was heading", async ({
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

    await page
      .getByRole("link", { name: "Continue to the Platform Console" })
      .click();
    await expect(page).toHaveURL(new RegExp(`${NEXT_PATH}/?$`, "u"));
    await expect(tenantsHeading(page)).toBeVisible();

    // A spent recovery code does not sign in a second time.
    await page.context().clearCookies();
    await signInToMfa(page);
    await page.getByLabel("Verification code").fill(recoveryCode);
    await page.getByRole("button", { name: "Verify" }).click();
    await expect(
      page.getByText(
        "The code is incorrect. Check your authenticator app and try again."
      )
    ).toBeVisible();
  });

  test("opening /mfa with no challenge goes to the sign-in screen", async ({
    page,
  }) => {
    await page.goto(`${WEB_PLATFORM_BASE_URL}/mfa`);

    await expect(page).toHaveURL(/\/login/u);
  });
});
