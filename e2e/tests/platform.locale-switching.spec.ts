import type { Locator, Page } from "@playwright/test";
import { expect, test } from "@playwright/test";

import { runSql } from "../src/db";
import {
  expectDocumentLocale,
  storedLocaleCookie,
  switchConsoleLocale,
} from "../src/locale";
import { signInAsSeedPlatformSuperAdmin } from "../src/platform";
import { WEB_PLATFORM_BASE_URL } from "../src/urls";

const platformUrl = (pathname: string): string =>
  `${WEB_PLATFORM_BASE_URL}${pathname}`;

const SAVE_DEFAULT_LOCALE = {
  English: "Save default language",
  日本語: "既定言語を保存",
} as const;

/**
 * The default-language card on the General settings screen, found by its own
 * save button: the screen carries a second card with the same shape for the
 * time zone, and the select inside is a Base UI trigger rather than a native
 * `<select>`.
 */
const defaultLocaleForm = (page: Page, saveLabel: string): Locator =>
  page
    .locator("form")
    .filter({ has: page.getByRole("button", { name: saveLabel }) });

const saveDefaultLocale = async (
  page: Page,
  from: keyof typeof SAVE_DEFAULT_LOCALE,
  to: keyof typeof SAVE_DEFAULT_LOCALE
): Promise<void> => {
  const form = defaultLocaleForm(page, SAVE_DEFAULT_LOCALE[from]);
  await form.getByRole("combobox").click();
  await page.getByRole("option", { exact: true, name: to }).click();
  await form.getByRole("button", { name: SAVE_DEFAULT_LOCALE[from] }).click();
};

/**
 * The platform console resolves its language from the `publira_locale` cookie
 * and, without one, from the row the General settings screen writes. Both ends
 * of that are here, and the second one is why this file is a project of its
 * own: `platform_config` is one row for the whole deployment, so the test that
 * changes it cannot share a runner with the specs that read the console in the
 * language it currently names.
 *
 * Serial, and the change is last, so a failure leaves the fewest tests behind
 * an unrestored setting; `afterAll` puts the row back either way.
 */
test.describe.configure({ mode: "serial" });

test.describe("web-platform display language", () => {
  test.afterAll(() => {
    runSql(
      "UPDATE platform_config SET default_locale = 'en', updated_at = NOW() WHERE singleton;"
    );
  });

  test("the header switcher stores the choice and re-renders the console in it", async ({
    page,
  }) => {
    await signInAsSeedPlatformSuperAdmin(page, "/settings/general");
    await expect(
      page.getByRole("heading", { level: 1, name: "Settings" })
    ).toBeVisible();
    await expectDocumentLocale(page, "English");
    expect(await storedLocaleCookie(page)).toBeUndefined();

    await switchConsoleLocale(page, "English", "日本語");

    await expect(
      page.getByRole("heading", { level: 1, name: "設定" })
    ).toBeVisible();
    await expectDocumentLocale(page, "日本語");
    expect(await storedLocaleCookie(page)).toBe("ja");

    // A reload proves the cookie is what carries it, not the action's answer.
    await page.reload();
    await expect(
      page.getByRole("heading", { level: 1, name: "設定" })
    ).toBeVisible();
    await expectDocumentLocale(page, "日本語");
  });

  test("a login screen with no session renders in the saved platform default", async ({
    page,
  }) => {
    const response = await page.goto(platformUrl("/login"));

    expect(response?.status(), await page.content()).toBe(200);
    await expect(page.getByText("Platform Console sign-in")).toBeVisible();
    await expect(
      page.getByRole("button", { exact: true, name: "Sign in" })
    ).toBeVisible();
    await expectDocumentLocale(page, "English");
  });

  test("changing the platform default changes what a visitor with no cookie sees", async ({
    browser,
    page,
  }) => {
    await signInAsSeedPlatformSuperAdmin(page, "/settings/general");
    await expect(
      page.getByRole("heading", { level: 1, name: "Settings" })
    ).toBeVisible();

    await saveDefaultLocale(page, "English", "日本語");

    // The operator chose no display language of their own, so the screen that
    // saved the setting is the first one it applies to.
    await expect(
      page.getByRole("heading", { level: 1, name: "設定" })
    ).toBeVisible();
    expect(await storedLocaleCookie(page)).toBeUndefined();

    const visitorContext = await browser.newContext();
    try {
      const visitor = await visitorContext.newPage();
      await visitor.goto(platformUrl("/login"));

      await expect(
        visitor.getByText("Platform Console ログイン")
      ).toBeVisible();
      await expect(
        visitor.getByRole("button", { exact: true, name: "ログイン" })
      ).toBeVisible();
      await expectDocumentLocale(visitor, "日本語");
    } finally {
      await visitorContext.close();
    }

    await saveDefaultLocale(page, "日本語", "English");
    await expect(
      page.getByRole("heading", { level: 1, name: "Settings" })
    ).toBeVisible();
  });
});
