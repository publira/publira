import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";

import { applyScenarioSql } from "../src/db";
import {
  READER_MFA_READER,
  STOREFRONT_READER_MFA_SCENARIO,
} from "../src/scenarios/storefront-reader-mfa";
import { fillLoginForm } from "../src/session";
import { totpCode } from "../src/totp";
import { storefrontPath, WEB_STOREFRONT_BASE_URL } from "../src/urls";

/**
 * A reader turning two-step verification on from **Settings** › **Security**,
 * signing in with its code and with a recovery code, and turning it off
 * again. Every step after the first depends on the one before it, so the
 * tests run in order on one account.
 */

const storefrontUrl = (pathname: string): string =>
  `${WEB_STOREFRONT_BASE_URL}${storefrontPath(pathname)}`;

const RETURN_TO = "/my/library";

const twoStepSection = (page: Page) =>
  page.getByRole("region", { name: "Two-step verification" });

/** Sign in with the password, which stops at the code step. */
const signInToCodeStep = async (page: Page): Promise<void> => {
  await page.context().clearCookies();
  await page.goto(
    storefrontUrl(`/login?returnTo=${encodeURIComponent(RETURN_TO)}`)
  );
  await fillLoginForm(page, READER_MFA_READER);
  await expect(page).toHaveURL(/\/login\/two-step$/u);
};

const expectReturned = async (page: Page): Promise<void> => {
  await expect(page).toHaveURL(new RegExp(`${RETURN_TO}/?$`, "u"));
};

test.describe.configure({ mode: "serial" });

test.beforeAll(() => {
  applyScenarioSql(STOREFRONT_READER_MFA_SCENARIO);
});

test.afterAll(() => {
  applyScenarioSql(STOREFRONT_READER_MFA_SCENARIO);
});

test.describe("storefront two-step verification", () => {
  let secret = "";
  let recoveryCodes: string[] = [];

  test("a reader turns it on and is shown the recovery codes once", async ({
    page,
  }) => {
    await page.goto(storefrontUrl("/login?returnTo=%2Fsettings%2Fsecurity"));
    await fillLoginForm(page, READER_MFA_READER);
    await expect(page).toHaveURL(/\/settings\/security\/?$/u);

    const section = twoStepSection(page);
    await expect(
      section.getByText("Two-step verification is off.")
    ).toBeVisible();
    await section.getByRole("button", { exact: true, name: "Turn on" }).click();

    await expect(
      section.getByRole("img", {
        name: "QR code for setting up two-step verification",
      })
    ).toBeVisible();

    const setupKey = await section.getByText(/^[A-Z2-7]{16,}$/u).textContent();

    secret = setupKey?.trim() ?? "";
    expect(secret).not.toBe("");

    await section.getByLabel("Verification code").fill(totpCode(secret));
    await section
      .getByRole("button", { name: "Turn on two-step verification" })
      .click();

    await expect(
      section.getByText("Two-step verification is now on.")
    ).toBeVisible();

    const codes = section
      .getByRole("list", { name: "Recovery codes" })
      .getByRole("code");

    await expect(codes).toHaveCount(10);
    const shown = await codes.allTextContents();
    recoveryCodes = shown.map((code) => code.trim());

    // The section is read again, and offers what keeps the factor.
    await expect(
      section.getByText("10 recovery codes left", { exact: true })
    ).toBeVisible();
    await expect(
      section.getByRole("button", { name: "Regenerate recovery codes" })
    ).toBeVisible();
    await expect(
      section.getByRole("button", { exact: true, name: "Turn off" })
    ).toBeVisible();

    // The codes are shown once: reading the page again does not bring them back.
    await page.reload();
    await expect(
      twoStepSection(page).getByText(recoveryCodes[0] ?? "")
    ).toHaveCount(0);
  });

  test("signing in with the password then asks for the code, and goes on to where the reader was heading", async ({
    page,
  }) => {
    await signInToCodeStep(page);

    // A wrong code keeps the reader on the step.
    await page.getByLabel("Verification code").fill("000000");
    await page.getByRole("button", { exact: true, name: "Verify" }).click();
    await expect(
      page.getByText(
        "The code is incorrect. Check your authenticator app and try again."
      )
    ).toBeVisible();
    await expect(page).toHaveURL(/\/login\/two-step$/u);

    // The enrollment spent the current step, so the next one is presented.
    await page.getByLabel("Verification code").fill(totpCode(secret, 1));
    await page.getByRole("button", { exact: true, name: "Verify" }).click();
    await expectReturned(page);
  });

  test("a recovery code signs the reader in once", async ({ page }) => {
    const [recoveryCode] = recoveryCodes;

    await signInToCodeStep(page);
    await page.getByRole("link", { name: "Use a recovery code" }).click();
    await page.getByLabel("Recovery code").fill(recoveryCode ?? "");
    await page.getByRole("button", { exact: true, name: "Verify" }).click();
    await expectReturned(page);

    await signInToCodeStep(page);
    await page.getByRole("link", { name: "Use a recovery code" }).click();
    await page.getByLabel("Recovery code").fill(recoveryCode ?? "");
    await page.getByRole("button", { exact: true, name: "Verify" }).click();
    await expect(
      page.getByText("The recovery code is incorrect or has already been used.")
    ).toBeVisible();
  });

  test("turning it off asks for the password and a code, and the password alone signs in again", async ({
    page,
  }) => {
    await signInToCodeStep(page);
    await page.getByRole("link", { name: "Use a recovery code" }).click();
    await page.getByLabel("Recovery code").fill(recoveryCodes[1] ?? "");
    await page.getByRole("button", { exact: true, name: "Verify" }).click();
    await expectReturned(page);

    await page.goto(storefrontUrl("/settings/security"));
    const section = twoStepSection(page);
    await expect(
      section.getByText("8 recovery codes left", { exact: true })
    ).toBeVisible();
    await section
      .getByLabel("Current password")
      .fill(READER_MFA_READER.password);
    await section
      .getByLabel("Verification code")
      .last()
      .fill(recoveryCodes[2] ?? "");
    await section
      .getByRole("button", { exact: true, name: "Turn off" })
      .click();

    await expect(
      page.getByText("Two-step verification is now off.")
    ).toBeVisible();
    await expect(
      twoStepSection(page).getByText("Two-step verification is off.")
    ).toBeVisible();

    await page.context().clearCookies();
    await page.goto(
      storefrontUrl(`/login?returnTo=${encodeURIComponent(RETURN_TO)}`)
    );
    await fillLoginForm(page, READER_MFA_READER);
    await expectReturned(page);
  });

  test("the code step without a sign-in to finish goes to the sign-in screen", async ({
    page,
  }) => {
    await page.context().clearCookies();
    await page.goto(storefrontUrl("/login/two-step"));

    await expect(page).toHaveURL(/\/login(?:\?|$)/u);
  });
});
