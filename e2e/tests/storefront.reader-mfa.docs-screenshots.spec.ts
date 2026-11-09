import { expect, test } from "@playwright/test";

import { applyScenarioSql } from "../src/db";
import {
  DOCS_LOCALES,
  docsSection,
  docsText,
  docsTextPattern,
  expectDocsScreenshot,
} from "../src/docs-screenshots";
import {
  READER_MFA_DOCS_READER,
  DOCS_READER_MFA_SCENARIO,
} from "../src/scenarios/storefront-reader-mfa";
import { signInAsMember } from "../src/storefront";
import { totpCode } from "../src/totp";
import { localeStorefrontPath, WEB_STOREFRONT_BASE_URL } from "../src/urls";

/**
 * A reader's two-step verification on the site, as
 * `docs/<locale>/4-console/2-readers/1-accounts.md` and
 * `docs/<locale>/3-operations/12-security/2-two-step-verification.md` show
 * it: setting it up under **Security**, the section once it is on, and the
 * code step a sign-in stops at.
 *
 * Turning it on enrolls the account `821_docs_reader_mfa.sql` keeps for
 * the documentation, the same account in every locale, so every locale's copy
 * of the test runs in order on one worker rather than beside the others.
 */

const storefrontUrl = (locale: string, pathname: string): string =>
  `${WEB_STOREFRONT_BASE_URL}${localeStorefrontPath(locale, pathname)}`;

test.describe("web-storefront two-step verification documentation screenshots", () => {
  test.describe.configure({ mode: "default" });

  test.afterAll(() => {
    applyScenarioSql(DOCS_READER_MFA_SCENARIO);
  });

  for (const locale of DOCS_LOCALES) {
    const t = (key: string): string => docsText(locale, key);

    test(`turning two-step verification on, and signing in with it, in ${locale}`, async ({
      page,
    }) => {
      // Every attempt starts with two-step verification off: one that got as
      // far as turning it on leaves the account stopping at the code, and its
      // retry would never reach the settings.
      applyScenarioSql(DOCS_READER_MFA_SCENARIO);

      // Where a sign-in returns to carries no locale, so the language is the
      // address opened afterwards.
      await signInAsMember(page, READER_MFA_DOCS_READER, "/settings/security");
      await page.goto(storefrontUrl(locale, "/settings/security"));
      const section = docsSection(page, t("storefront.settings.mfa_heading"));

      await section
        .getByRole("button", {
          exact: true,
          name: t("storefront.settings.mfa_enable"),
        })
        .click();

      const qrCode = section.getByRole("img", {
        name: t("storefront.settings.mfa_qr_label"),
      });

      const setupKey = section.getByText(/^[A-Z2-7]{16,}$/u);
      await expect(setupKey).toBeVisible();
      const setupKeyText = await setupKey.textContent();
      const secret = setupKeyText?.trim() ?? "";

      // The QR code and the key are drawn for this setup alone, so they are
      // covered over: no other run shows the same ones.
      await expectDocsScreenshot(page, {
        element: section,
        locale,
        mask: [qrCode, setupKey],
        page: "console/readers/accounts",
        subject: "two-step-setup",
      });

      await section
        .getByLabel(t("storefront.auth.two_step.code_label"))
        .fill(totpCode(secret));
      await section
        .getByRole("button", { name: t("storefront.settings.mfa_confirm") })
        .click();

      const recoveryCodes = section
        .getByRole("list", {
          name: t("storefront.settings.mfa_recovery_codes_title"),
        })
        .getByRole("code");

      await expect(recoveryCodes).toHaveCount(10);
      // The codes arrive with the submission's answer, ahead of the section
      // read again with the forms of a factor that is on, which is the
      // section the image shows.
      await expect(
        section.getByRole("button", {
          exact: true,
          name: t("storefront.settings.mfa_disable"),
        })
      ).toBeVisible();

      await expectDocsScreenshot(page, {
        element: section,
        locale,
        // The day it was turned on is the day the shot is taken.
        mask: [
          recoveryCodes,
          section.getByText(
            docsTextPattern(locale, "storefront.settings.mfa_status_enabled")
          ),
        ],
        page: "operations/security/two-step-verification",
        subject: "reader-settings",
      });

      // Signed out, signing in again stops at the code. The sign-in helper
      // finds the form by its English copy, so the language waits until then.
      await page.context().clearCookies();
      await signInAsMember(page, READER_MFA_DOCS_READER, "/");
      await expect(page).toHaveURL(/\/login\/two-step$/u);
      await page.goto(storefrontUrl(locale, "/login/two-step"));

      await expectDocsScreenshot(page, {
        element: page.getByRole("main"),
        locale,
        page: "console/readers/accounts",
        subject: "two-step-code",
      });
    });
  }
});
