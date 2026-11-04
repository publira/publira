import { expect } from "@playwright/test";

import { test } from "../src/console-sessions";
import {
  DOCS_LOCALES,
  docsSection,
  docsText,
  expectDocsScreenshot,
  setDocsLocale,
} from "../src/docs-screenshots";
import {
  DOCS_WEBHOOKS_ADMIN,
  DOCS_WEBHOOKS_ENDPOINT_URL,
} from "../src/scenarios/docs-webhooks";
import { WEB_ADMIN_DOCS_WEBHOOKS_BASE_URL } from "../src/urls";

/**
 * The tenant console's API keys and webhooks, as
 * `docs/<locale>/4-console/10-api-keys-and-webhooks.md` shows them: the keys
 * with the form that creates one, a saved endpoint, and its deliveries.
 *
 * It is photographed on the tenant of
 * `db/seeds/scenarios/801_docs_webhooks.sql`, whose keys, endpoint, and
 * deliveries are written as literals, so every prefix, hint, and date on
 * screen is the same on every run. Nothing is created from the forms, since a
 * key created for one locale's shot would be listed in the next one's.
 */
test.use({ baseURL: WEB_ADMIN_DOCS_WEBHOOKS_BASE_URL });

const PAGE_PATH = "/integrations/api-keys-and-webhooks";

const PAGE = "console/api-keys-and-webhooks";

for (const locale of DOCS_LOCALES) {
  const t = (key: string): string => docsText(locale, key);

  test.describe(`web-admin API keys and webhooks documentation screenshots in ${locale}`, () => {
    test.beforeEach(async ({ consoleSessions, page }) => {
      await consoleSessions.signIn(
        page,
        DOCS_WEBHOOKS_ADMIN,
        WEB_ADMIN_DOCS_WEBHOOKS_BASE_URL
      );
      await setDocsLocale(page, WEB_ADMIN_DOCS_WEBHOOKS_BASE_URL, locale);
      await page.goto(PAGE_PATH);
    });

    test("the API keys", async ({ page }) => {
      const keys = docsSection(page, t("admin.settings.api_keys.title"));

      await expect(keys.getByRole("row")).toHaveCount(4);

      await expectDocsScreenshot(page, {
        element: keys,
        locale,
        page: PAGE,
        subject: "api-keys",
      });
    });

    test("an endpoint", async ({ page }) => {
      const endpoint = page.getByRole("region", {
        exact: true,
        name: DOCS_WEBHOOKS_ENDPOINT_URL,
      });

      await expect(endpoint).toBeVisible();

      await expectDocsScreenshot(page, {
        element: endpoint,
        locale,
        page: PAGE,
        subject: "endpoint",
      });
    });

    test("the deliveries", async ({ page }) => {
      const deliveries = docsSection(
        page,
        t("admin.settings.webhooks.deliveries.title")
      );

      await expect(deliveries.getByRole("row")).toHaveCount(5);

      await expectDocsScreenshot(page, {
        element: deliveries,
        locale,
        page: PAGE,
        subject: "deliveries",
      });
    });
  });
}
