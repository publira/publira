import type { Locator, Page } from "@playwright/test";
import { expect, test } from "@playwright/test";

import { applyScenarioSql, emptyPlatformOperators, querySql } from "../src/db";
import { expectDocumentLocale } from "../src/locale";
import {
  PLATFORM_SETUP_SCENARIO,
  SETUP_DEFAULT_LOCALE_CODE,
  SETUP_DEFAULT_LOCALE_LABEL,
  SETUP_OPERATOR,
} from "../src/scenarios/platform-setup";
import { fillLoginForm } from "../src/session";
import { WEB_PLATFORM_BASE_URL } from "../src/urls";

const platformUrl = (pathname: string): string =>
  `${WEB_PLATFORM_BASE_URL}${pathname}`;

/**
 * `Password` told apart from `Password (confirm)`: both labels start the same
 * way, and `FieldLabel required` appends the asterisk that ends this one.
 */
const passwordInput = (page: Page): Locator =>
  page.getByLabel(/^Password\s*\*$/u);

const savedDefaultLocale = (): string =>
  querySql("SELECT default_locale FROM platform_config WHERE singleton");

/**
 * Platform Console initial setup: `/setup` → `CreateInitialUser` → the console.
 *
 * Isolated project `platform-setup` (see playwright.config.ts), chained after
 * every other project. The screen renders only while the platform has no
 * operator at all — `CheckSetupStatus` reports setup as complete as soon as one
 * `platform_users` row exists — so this suite is the only one that may empty
 * that table, and it can only do so once nothing else needs an operator to sign
 * in as. `afterAll` re-applies the development seed's platform rows whether the
 * suite passed or failed.
 *
 * The browser asks for English throughout. The setup screen answers in it,
 * because a platform that has saved nothing has only `Accept-Language` to go on;
 * every screen after the form answers in Japanese, because that is the language
 * the form chose and saved. Those two together are what separate the stored
 * platform default from the visitor's own preference.
 *
 * Serial: the second test asserts what `/setup` does once the first has given
 * the platform an operator, so it has nothing to say if the first one failed.
 */
test.describe.configure({ mode: "serial" });

test.describe("web-platform initial setup", () => {
  test.use({ locale: "en-US" });

  test.beforeAll(() => {
    emptyPlatformOperators();
  });

  test.afterAll(() => {
    applyScenarioSql(PLATFORM_SETUP_SCENARIO);
  });

  test("the form creates the first operator and saves the language it chose", async ({
    page,
  }) => {
    const response = await page.goto(platformUrl("/setup"));

    expect(response?.status(), await page.content()).toBe(200);
    // Exact: the screen's own <title> is "Initial setup | Publira Platform
    // Console", and `getByText` reaches into <head>.
    await expect(
      page.getByText("Initial setup", { exact: true })
    ).toBeVisible();
    await expect(
      page.getByText("Create the first administrator account.")
    ).toBeVisible();

    // The selector opens on what the browser asked for: there is no saved
    // language yet, which is the whole reason this screen chooses one.
    const localeSelect = page.getByRole("combobox");
    await expect(localeSelect).toHaveText("English");

    await page
      .getByRole("textbox", { name: /^Full name/u })
      .fill(SETUP_OPERATOR.name);
    await page
      .getByRole("textbox", { name: /^Email address/u })
      .fill(SETUP_OPERATOR.email);
    await passwordInput(page).fill(SETUP_OPERATOR.password);
    await page
      .getByLabel(/^Password \(confirm\)/u)
      .fill(SETUP_OPERATOR.password);

    await localeSelect.click();
    await page
      .getByRole("option", { exact: true, name: SETUP_DEFAULT_LOCALE_LABEL })
      .click();
    await page.getByRole("button", { name: "Create administrator" }).click();

    await page.waitForURL(
      (url) => url.pathname === "/login" && url.search === "?setup=done"
    );
    expect(savedDefaultLocale()).toBe(SETUP_DEFAULT_LOCALE_CODE);

    // A fresh document rather than the Action's client-side redirect: `<html
    // lang>` is written by the inline script in the root layout, which only runs
    // on a real navigation.
    await page.goto(platformUrl("/login"));
    await expect(page.getByText("Platform Console ログイン")).toBeVisible();
    await expectDocumentLocale(page, SETUP_DEFAULT_LOCALE_LABEL);

    await fillLoginForm(page, SETUP_OPERATOR);
    await expect(
      page.getByRole("heading", {
        level: 1,
        name: "横断オペレーションの基準点",
      })
    ).toBeVisible();

    // The first operator is a super admin, which is what makes the console
    // usable at all: nobody else can invite the second one.
    await page.goto(platformUrl("/operators"));
    const row = page.locator("tr", { hasText: SETUP_OPERATOR.email });
    await expect(row.getByText(SETUP_OPERATOR.name)).toBeVisible();
    await expect(
      row.getByText("スーパー管理者", { exact: true })
    ).toBeVisible();
    await expect(row.getByText("有効", { exact: true })).toBeVisible();
  });

  test("/setup sends the operator to the login screen once one exists", async ({
    page,
  }) => {
    const response = await page.goto(platformUrl("/setup"));

    expect(response?.status(), await page.content()).toBe(200);
    await page.waitForURL((url) => url.pathname === "/login");
    await expect(
      page.getByRole("button", { exact: true, name: "ログイン" })
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "管理ユーザーを作成する" })
    ).toHaveCount(0);
  });
});
