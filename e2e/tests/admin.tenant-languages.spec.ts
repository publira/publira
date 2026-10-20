import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import { signInAsAdmin } from "../src/admin";
import { applyScenarioSql } from "../src/db";
import {
  TENANT_LANGUAGES_ADMIN,
  TENANT_LANGUAGES_PAGE,
  TENANT_LANGUAGES_SCENARIO,
  TENANT_LANGUAGES_SERIES,
} from "../src/scenarios/tenant-languages";
import { WEB_ADMIN_TENANT_LANGUAGES_BASE_URL } from "../src/urls";

/**
 * A Tenant admin chooses the languages the site offers under Settings, and the
 * console follows: a page translation in a language switched off loses its tab
 * without being deleted, and has it back, as it was, once the language is
 * switched on again; and a series is listed under its title in whichever
 * language is the default.
 */

const adminUrl = (pathname: string): string =>
  `${WEB_ADMIN_TENANT_LANGUAGES_BASE_URL}${pathname}`;

const pagePath = `/pages/${TENANT_LANGUAGES_PAGE.id}`;

/** The box of one language on the Languages card, by its autonym. */
const languageBox = (page: Page, autonym: string) =>
  page.getByRole("checkbox", { exact: true, name: autonym });

const saveLanguages = async (page: Page): Promise<void> => {
  await page.getByRole("button", { name: "Save the languages" }).click();
  await expect(page.getByText("The languages were saved.")).toBeVisible({
    timeout: 30_000,
  });
};

const chooseDefaultLanguage = async (
  page: Page,
  autonym: string
): Promise<void> => {
  await page.getByRole("combobox", { name: /^Default language/u }).click();
  await page.getByRole("option", { exact: true, name: autonym }).click();
};

const languageTabs = (page: Page) =>
  page.getByRole("navigation", { name: "Languages" });

// The tenant's languages are one setting every test reads, so the suite runs
// in order and puts them back around either outcome.
test.describe.configure({ mode: "serial" });

test.describe("admin tenant languages", () => {
  test.beforeAll(() => {
    applyScenarioSql(TENANT_LANGUAGES_SCENARIO);
  });

  test.afterAll(() => {
    applyScenarioSql(TENANT_LANGUAGES_SCENARIO);
  });

  test.beforeEach(async ({ page }) => {
    // A console without a stored choice renders in the default language, so
    // the choice is stored to keep the screens in English while the default
    // moves.
    await page.context().addCookies([
      {
        name: "publira_locale",
        url: WEB_ADMIN_TENANT_LANGUAGES_BASE_URL,
        value: "en",
      },
    ]);
    await signInAsAdmin(
      page,
      TENANT_LANGUAGES_ADMIN,
      "/settings",
      WEB_ADMIN_TENANT_LANGUAGES_BASE_URL
    );
  });

  test("the default language stays offered", async ({ page }) => {
    await expect(languageBox(page, "English")).toBeChecked();
    await expect(languageBox(page, "English")).toBeDisabled();
    await expect(languageBox(page, "日本語")).toBeChecked();
    await expect(languageBox(page, "日本語")).toBeEnabled();
    await expect(languageBox(page, "한국어")).not.toBeChecked();
  });

  test("a language switched off hides its translation's tab until it is switched on again", async ({
    page,
  }) => {
    await languageBox(page, "日本語").click();
    await expect(languageBox(page, "日本語")).not.toBeChecked();
    await saveLanguages(page);

    await page.goto(adminUrl(pagePath));
    await expect(
      languageTabs(page).getByRole("link", { exact: true, name: "English" })
    ).toHaveAttribute("aria-current", "page");
    await expect(
      languageTabs(page).getByRole("link", { name: /^日本語/u })
    ).toHaveCount(0);

    // A URL that still names the language opens the default translation.
    await page.goto(adminUrl(`${pagePath}?locale=ja`));
    await expect(page.getByRole("textbox", { name: "Title" })).toHaveValue(
      TENANT_LANGUAGES_PAGE.englishTitle
    );

    await page.goto(adminUrl("/settings"));
    await languageBox(page, "日本語").click();
    await saveLanguages(page);

    await page.goto(adminUrl(pagePath));
    await languageTabs(page)
      .getByRole("link", { exact: true, name: "日本語" })
      .click();
    await expect(page.getByRole("textbox", { name: "Title" })).toHaveValue(
      TENANT_LANGUAGES_PAGE.japaneseTitle
    );
  });

  test("the series list names a series in the new default language as soon as it is saved", async ({
    page,
  }) => {
    const seriesTitle = (title: string) =>
      page.getByText(title, { exact: true });

    // Each list is read once before the default moves, so a list kept from
    // the previous default would be what the next visit shows.
    await page.goto(adminUrl("/series"));
    await expect(
      seriesTitle(TENANT_LANGUAGES_SERIES.englishTitle)
    ).toBeVisible();

    await page.goto(adminUrl("/settings"));
    await chooseDefaultLanguage(page, "日本語");
    await saveLanguages(page);

    await page.goto(adminUrl("/series"));
    await expect(
      seriesTitle(TENANT_LANGUAGES_SERIES.japaneseTitle)
    ).toBeVisible();

    await page.goto(adminUrl("/settings"));
    await chooseDefaultLanguage(page, "English");
    await saveLanguages(page);

    await page.goto(adminUrl("/series"));
    await expect(
      seriesTitle(TENANT_LANGUAGES_SERIES.englishTitle)
    ).toBeVisible();
    await expect(
      seriesTitle(TENANT_LANGUAGES_SERIES.japaneseTitle)
    ).toHaveCount(0);
  });
});
