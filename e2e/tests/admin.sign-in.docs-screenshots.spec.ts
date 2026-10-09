import { generateKeyPairSync } from "node:crypto";

import { expect, test } from "@playwright/test";

import { signInAsAdmin } from "../src/admin";
import {
  DOCS_LOCALES,
  docsText,
  expectDocsScreenshot,
  setDocsLocale,
} from "../src/docs-screenshots";
import { SIGN_IN_PROVIDERS_ADMIN } from "../src/scenarios/sign-in-providers";
import { WEB_ADMIN_SIGN_IN_PROVIDERS_BASE_URL } from "../src/urls";

/**
 * The tenant console's sign-in providers, as
 * `docs/<locale>/4-console/6-sign-in.md` shows them: Apple and Google, each
 * offered, with where readers see its button.
 *
 * Saving them changes the sign-in screens of the tenant's site, so they are
 * saved on the tenant of `db/seeds/scenarios/340_sign_in_providers.sql`,
 * which names an iOS app, and which the setup of this project and the sign-in
 * providers suite each write afresh before they run.
 */
test.use({ baseURL: WEB_ADMIN_SIGN_IN_PROVIDERS_BASE_URL });

const SIGN_IN_PATH = "/integrations/sign-in";

// Generated per run, as the sign-in providers suite generates its own: the
// server accepts a real P-256 key, and the console never shows it back.
const APPLE_KEY = generateKeyPairSync("ec", {
  namedCurve: "P-256",
  privateKeyEncoding: { format: "pem", type: "pkcs8" },
  publicKeyEncoding: { format: "pem", type: "spki" },
}).privateKey;

for (const locale of DOCS_LOCALES) {
  const t = (key: string): string => docsText(locale, key);

  test.describe(`web-admin sign-in documentation screenshots in ${locale}`, () => {
    test("Apple and Google, offered", async ({ page }) => {
      await signInAsAdmin(
        page,
        SIGN_IN_PROVIDERS_ADMIN,
        SIGN_IN_PATH,
        WEB_ADMIN_SIGN_IN_PROVIDERS_BASE_URL
      );
      await setDocsLocale(page, WEB_ADMIN_SIGN_IN_PROVIDERS_BASE_URL, locale);
      await page.goto(SIGN_IN_PATH);

      const apple = page.getByRole("group", {
        exact: true,
        name: t("admin.settings.sign_in.apple.title"),
      });
      const google = page.getByRole("group", {
        exact: true,
        name: t("admin.settings.sign_in.google.title"),
      });

      await apple
        .getByRole("checkbox", {
          name: t("admin.settings.sign_in.apple.enabled"),
        })
        .check();
      await apple
        .getByRole("textbox", {
          name: t("admin.settings.sign_in.apple.services_id"),
        })
        .fill("com.example.comics.web");
      await apple
        .getByRole("textbox", {
          name: t("admin.settings.sign_in.apple.team_id"),
        })
        .fill("ABCDE12345");
      await apple
        .getByRole("textbox", {
          name: t("admin.settings.sign_in.apple.key_id"),
        })
        .fill("2X9R4HXF34");
      await page.locator('input[name="apple_private_key_file"]').setInputFiles({
        buffer: Buffer.from(APPLE_KEY),
        mimeType: "application/octet-stream",
        name: "AuthKey_2X9R4HXF34.p8",
      });
      await google
        .getByRole("checkbox", {
          name: t("admin.settings.sign_in.google.enabled"),
        })
        .check();
      await google
        .getByRole("textbox", {
          name: t("admin.settings.sign_in.google.web_client_id"),
        })
        .fill("123456789012-abc123.apps.googleusercontent.com");
      await page
        .getByRole("button", { name: t("admin.settings.sign_in.submit") })
        .click();
      await expect(
        page.getByText(t("admin.settings.sign_in.saved"))
      ).toBeVisible();
      await page.reload();

      // The key is generated for this run, and the console shows the last
      // characters of it.
      await expectDocsScreenshot(page, {
        element: apple,
        locale,
        mask: [
          apple.getByRole("textbox", {
            name: t("admin.settings.sign_in.apple.private_key"),
          }),
        ],
        page: "console/sign-in",
        subject: "apple",
      });
      await expectDocsScreenshot(page, {
        element: google,
        locale,
        page: "console/sign-in",
        subject: "google",
      });
    });
  });
}
