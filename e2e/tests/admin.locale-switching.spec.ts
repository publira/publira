import { expect, test } from "@playwright/test";

import { signInAsSeedAdmin } from "../src/admin";
import { applyScenarioSql } from "../src/db";
import {
  expectDocumentLocale,
  storedLocaleCookie,
  switchConsoleLocale,
} from "../src/locale";
import { LOCALE_SWITCHING_SCENARIO } from "../src/scenarios/locale-switching";
import {
  WEB_ADMIN_BASE_URL,
  WEB_ADMIN_ENGLISH_DEFAULT_BASE_URL,
} from "../src/urls";

const adminUrl = (pathname: string, baseUrl = WEB_ADMIN_BASE_URL): string =>
  `${baseUrl}${pathname}`;

/**
 * The console keeps no locale in its URLs: the operator's choice lives in the
 * `publira_locale` cookie, and a request without one renders in the language
 * the tenant saved. `proxy.test.ts` covers the cookie parsing; what a running
 * stack adds is that the choice survives a reload, that the saved default
 * answers a screen with no session at all, and that the two resolve in that
 * order.
 */
test.describe("web-admin display language", () => {
  test("the header switcher stores the choice and re-renders the console in it", async ({
    page,
  }) => {
    await signInAsSeedAdmin(page, "/settings");
    await expect(
      page.getByRole("heading", { level: 1, name: "設定" })
    ).toBeVisible();
    await expectDocumentLocale(page, "日本語");
    expect(await storedLocaleCookie(page)).toBeUndefined();

    await switchConsoleLocale(page, "日本語", "English");

    // Same round trip: the Server Action answers with the re-rendered screen,
    // and the control sets `<html lang>` itself because the shell is static.
    await expect(
      page.getByRole("heading", { level: 1, name: "Settings" })
    ).toBeVisible();
    await expectDocumentLocale(page, "English");
    expect(await storedLocaleCookie(page)).toBe("en");

    // A reload proves the cookie is what carries it, not the action's answer.
    await page.reload();
    await expect(
      page.getByRole("heading", { level: 1, name: "Settings" })
    ).toBeVisible();
    await expectDocumentLocale(page, "English");

    await switchConsoleLocale(page, "English", "日本語");

    await expect(
      page.getByRole("heading", { level: 1, name: "設定" })
    ).toBeVisible();
    await expectDocumentLocale(page, "日本語");
    expect(await storedLocaleCookie(page)).toBe("ja");
  });
});

/**
 * The login screen has no session, so it has no operator to have made a
 * choice. It renders in what the tenant saved, which is read from the public
 * `GetTenant` — and the two seeded tenants save different languages, so the
 * same screen answers in two of them.
 *
 * Two tenants rather than one tenant edited mid-run: that read is a shared
 * `"use cache"` entry with `cacheLife("hours")`, dropped by the tag the admin
 * API revalidates, and the E2E stack runs the APIs without the revalidation
 * settings — https://github.com/publira/publira/issues/1509.
 */
test.describe("web-admin default language", () => {
  test.beforeAll(() => {
    applyScenarioSql(LOCALE_SWITCHING_SCENARIO);
  });

  test("a console with no stored choice opens in the tenant's saved default", async ({
    page,
  }) => {
    const japanese = await page.goto(adminUrl("/login"));

    expect(japanese?.status(), await page.content()).toBe(200);
    await expect(page.getByText("管理画面ログイン")).toBeVisible();
    await expect(
      page.getByRole("button", { exact: true, name: "ログイン" })
    ).toBeVisible();
    await expectDocumentLocale(page, "日本語");

    const english = await page.goto(
      adminUrl("/login", WEB_ADMIN_ENGLISH_DEFAULT_BASE_URL)
    );

    expect(english?.status(), await page.content()).toBe(200);
    await expect(page.getByText("Admin console sign-in")).toBeVisible();
    await expect(
      page.getByRole("button", { exact: true, name: "Sign in" })
    ).toBeVisible();
    await expectDocumentLocale(page, "English");
  });

  test("a stored choice wins over the tenant default on a screen with no session", async ({
    page,
  }) => {
    await page.context().addCookies([
      {
        name: "publira_locale",
        url: WEB_ADMIN_ENGLISH_DEFAULT_BASE_URL,
        value: "ja",
      },
    ]);

    await page.goto(adminUrl("/login", WEB_ADMIN_ENGLISH_DEFAULT_BASE_URL));

    await expect(page.getByText("管理画面ログイン")).toBeVisible();
    await expectDocumentLocale(page, "日本語");
  });
});
