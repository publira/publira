import { expect, test } from "@playwright/test";

import { signInAsAdmin } from "../src/admin";
import { setTenantCoinsAllowed } from "../src/coins";
import { applyScenarioSql } from "../src/db";
import {
  DOCS_LOCALES,
  docsField,
  docsSection,
  docsText,
  expectDocsScreenshot,
  setDocsLocale,
} from "../src/docs-screenshots";
import { PLATFORM_TENANT_COINS_SCENARIO } from "../src/scenarios/platform-tenant-coins";
import {
  STOREFRONT_COINS_ADMIN,
  STOREFRONT_COINS_SCENARIO,
} from "../src/scenarios/storefront-coins";
import { WEB_ADMIN_COINS_BASE_URL } from "../src/urls";

/**
 * The tenant console's Coins screen, as `docs/<locale>/4-console/9-coins.md`
 * shows it: the settings, the packs, and turning coins off refused while a
 * reader holds some.
 *
 * It is photographed on the coins tenant of
 * `db/seeds/scenarios/700_storefront_coins.sql`, whose coins are on, named,
 * and sold in three packs, and one of whose readers holds 100 of them. The
 * screen is offered only while the platform lets tenants issue coins, which
 * `platform_policy_config` holds once for the whole deployment, so this runs
 * in a project of its own in the exclusive chain, allows coins for as long as
 * it runs, and turns the allowance off again after itself.
 */
test.use({ baseURL: WEB_ADMIN_COINS_BASE_URL });

const COINS_PATH = "/coins";

const PAGE = "console/coins";

test.describe.configure({ mode: "serial" });

test.beforeAll(async ({ browser }) => {
  applyScenarioSql(STOREFRONT_COINS_SCENARIO);
  applyScenarioSql(PLATFORM_TENANT_COINS_SCENARIO);
  const page = await browser.newPage();
  try {
    await setTenantCoinsAllowed(page, true);
  } finally {
    await page.close();
  }
});

test.afterAll(async ({ browser }) => {
  const page = await browser.newPage();
  try {
    await setTenantCoinsAllowed(page, false);
  } finally {
    await page.close();
  }
  applyScenarioSql(STOREFRONT_COINS_SCENARIO);
});

for (const locale of DOCS_LOCALES) {
  const t = (key: string): string => docsText(locale, key);

  test.describe(`web-admin coins documentation screenshots in ${locale}`, () => {
    test.beforeEach(async ({ page }) => {
      await signInAsAdmin(
        page,
        STOREFRONT_COINS_ADMIN,
        COINS_PATH,
        WEB_ADMIN_COINS_BASE_URL
      );
      await setDocsLocale(page, WEB_ADMIN_COINS_BASE_URL, locale);
      await page.goto(COINS_PATH);
    });

    test("the coin settings", async ({ page }) => {
      const settings = docsSection(page, t("admin.coins.settings.title"));
      await expect(
        settings.getByRole("button", { name: t("admin.coins.settings.submit") })
      ).toBeVisible();

      await expectDocsScreenshot(page, {
        element: settings,
        locale,
        page: PAGE,
        subject: "settings",
      });
    });

    test("the packs", async ({ page }) => {
      const packs = docsSection(page, t("admin.coins.packs.title"));
      await expect(packs.getByRole("listitem")).toHaveCount(3);

      await expectDocsScreenshot(page, {
        element: packs,
        locale,
        page: PAGE,
        subject: "packs",
      });
    });

    test("turning coins off refused while a reader holds some", async ({
      page,
    }) => {
      const enabled = page.getByRole("checkbox", {
        exact: true,
        name: t("admin.coins.settings.enabled"),
      });
      await enabled.uncheck();
      await page
        .getByRole("button", { name: t("admin.coins.settings.submit") })
        .click();
      const switches = docsField(enabled);
      await expect(switches.getByRole("status")).toBeVisible();

      await expectDocsScreenshot(page, {
        element: switches,
        locale,
        page: PAGE,
        subject: "turning-off",
      });
    });
  });
}
