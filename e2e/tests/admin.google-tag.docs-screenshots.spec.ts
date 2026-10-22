import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";

import { signInAsAdmin } from "../src/admin";
import {
  DOCS_LOCALES,
  docsField,
  docsLabelPattern,
  docsScreen,
  docsText,
  expectDocsScreenshot,
  setDocsLocale,
} from "../src/docs-screenshots";
import { DOCS_GOOGLE_TAG_ADMIN } from "../src/scenarios/docs-google-tag";
import { WEB_ADMIN_DOCS_GOOGLE_TAG_BASE_URL } from "../src/urls";

/**
 * The tenant console's Google tag form, as
 * `docs/<locale>/4-console/7-google-tag.md` shows it: the IDs and the serving
 * modes, the server container URL, the gateway path with the tag it is set up
 * for, and the dialog that generates a new path.
 *
 * It is photographed on the tenant of
 * `db/seeds/scenarios/600_docs_google_tag.sql`, which saves a Tag Manager
 * container in the gateway mode under a gateway path written as a literal, so
 * the path on screen is the same on every run. The other modes are chosen on
 * the form and never saved.
 */
test.use({ baseURL: WEB_ADMIN_DOCS_GOOGLE_TAG_BASE_URL });

const GOOGLE_TAG_PATH = "/integrations/google-tag";

const PAGE = "console/google-tag";

for (const locale of DOCS_LOCALES) {
  const t = (key: string): string => docsText(locale, key);
  const servingMode = (page: Page, mode: string) =>
    page.getByRole("radio", {
      exact: true,
      name: t(`admin.settings.google_tag.serving_modes.${mode}.label`),
    });

  test.describe(`web-admin Google tag documentation screenshots in ${locale}`, () => {
    test.beforeEach(async ({ page }) => {
      await signInAsAdmin(
        page,
        DOCS_GOOGLE_TAG_ADMIN,
        GOOGLE_TAG_PATH,
        WEB_ADMIN_DOCS_GOOGLE_TAG_BASE_URL
      );
      await setDocsLocale(page, WEB_ADMIN_DOCS_GOOGLE_TAG_BASE_URL, locale);
      await page.goto(GOOGLE_TAG_PATH);
    });

    test("the IDs and the serving modes", async ({ page }) => {
      await servingMode(page, "google").click();
      await expect(servingMode(page, "google")).toBeChecked();

      await expectDocsScreenshot(page, {
        element: docsScreen(page),
        locale,
        page: PAGE,
        subject: "form",
      });
    });

    test("the server container URL", async ({ page }) => {
      await servingMode(page, "server_container").click();
      const url = page.getByRole("textbox", {
        name: docsLabelPattern(
          locale,
          "admin.settings.google_tag.server_container_url"
        ),
      });
      await url.fill("https://sgtm.example.com");

      await expectDocsScreenshot(page, {
        element: [docsField(servingMode(page, "google")), docsField(url)],
        locale,
        page: PAGE,
        subject: "server-container",
      });
    });

    test("the gateway path and its tag ID", async ({ page }) => {
      await expect(servingMode(page, "gateway")).toBeChecked();

      // The gateway's fields are one block of the form, outside the fieldset
      // of the fields a save submits, so the row of its first label is all
      // of them.
      await expectDocsScreenshot(page, {
        element: docsField(
          page.getByText(t("admin.settings.google_tag.gateway_path"), {
            exact: true,
          })
        ),
        locale,
        page: PAGE,
        subject: "gateway",
      });
    });

    test("generating a new gateway path", async ({ page }) => {
      await page
        .getByRole("button", {
          name: t("admin.settings.google_tag.gateway_path_regenerate"),
        })
        .click();

      await expectDocsScreenshot(page, {
        element: page.getByRole("alertdialog").or(page.getByRole("dialog")),
        locale,
        page: PAGE,
        subject: "regenerate",
      });
    });
  });
}
