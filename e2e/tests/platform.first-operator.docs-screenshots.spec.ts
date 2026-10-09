import { expect, test } from "@playwright/test";

import { applyScenarioSql, emptyPlatformOperators } from "../src/db";
import {
  DOCS_LOCALES,
  docsText,
  expectDocsScreenshot,
  setDocsLocale,
} from "../src/docs-screenshots";
import { PLATFORM_SETUP_SCENARIO } from "../src/scenarios/platform-setup";
import { WEB_PLATFORM_BASE_URL } from "../src/urls";

/**
 * The Platform Console's **Initial setup** screen, for **The first operator**
 * on `docs/<locale>/3-operations/1-platform-console.md`.
 *
 * The screen renders only while the platform has no operator at all, and every
 * other console screen in the suite needs one to sign in as, so this file runs
 * in a project of its own, `docs-screenshots-first-operator`, right before
 * `platform-setup` at the end of the exclusive chain, rather than beside the
 * other documentation screenshots. It empties the operators the way
 * `platform.setup.spec.ts` does, photographs the form without submitting it,
 * and puts back the development seed's platform rows and the documentation's
 * own operators however it ended.
 */
test.use({ baseURL: WEB_PLATFORM_BASE_URL });

/**
 * Put back what the test emptied: the development seed's platform rows, and
 * the operators `470_docs_platform.sql` writes for the other documentation
 * screenshots.
 */
const restoreOperators = (): void => {
  applyScenarioSql(PLATFORM_SETUP_SCENARIO);
  applyScenarioSql("470_docs_platform");
};

for (const locale of DOCS_LOCALES) {
  test(`the initial setup screen in ${locale}`, async ({ page }) => {
    emptyPlatformOperators();
    try {
      await setDocsLocale(page, WEB_PLATFORM_BASE_URL, locale);
      await page.goto("/setup");

      await expect(
        page.getByRole("button", {
          name: docsText(locale, "platform.auth.setup.submit"),
        })
      ).toBeVisible();

      await expectDocsScreenshot(page, {
        element: page.getByRole("main"),
        locale,
        page: "operations/platform-console",
        subject: "initial-setup",
      });
    } finally {
      restoreOperators();
    }
  });
}
