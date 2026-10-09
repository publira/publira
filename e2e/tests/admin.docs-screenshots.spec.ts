import { expect, test } from "@playwright/test";

import {
  DOCS_LOCALES,
  expectDocsScreenshot,
  setDocsLocale,
} from "../src/docs-screenshots";
import { WEB_ADMIN_BASE_URL } from "../src/urls";

/**
 * The tenant console as the pages under `docs/<locale>/4-console/` show it.
 *
 * Each test takes the region one passage explains and compares it with the
 * image beside that page, so a change to the console that alters a documented
 * screen fails here until the image is regenerated. The project runs before
 * the publishing suites, so the console holds what `task e2e:db` seeded.
 */
test.use({ baseURL: WEB_ADMIN_BASE_URL });

for (const locale of DOCS_LOCALES) {
  test.describe(`web-admin documentation screenshots in ${locale}`, () => {
    test("the sign-in screen, for Signing in on the console's overview", async ({
      page,
    }) => {
      await setDocsLocale(page, WEB_ADMIN_BASE_URL, locale);
      await page.goto("/login");

      await expect(
        page.getByRole("heading", { level: 1, name: "Publira" })
      ).toBeVisible();

      await expectDocsScreenshot(page, {
        element: page.getByRole("main"),
        locale,
        page: "console",
        subject: "sign-in",
      });
    });
  });
}
