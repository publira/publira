import type { Locator, Page, Response } from "@playwright/test";
import { expect } from "@playwright/test";

/**
 * The languages the product offers, named by the autonym every language menu in
 * it lists — the one string that does not change with the locale the page is
 * currently rendered in.
 */
export type LocaleLabel = "English" | "日本語" | "한국어";

/** The code the same choice is stored and served under. */
export const LOCALE_CODE: Record<LocaleLabel, string> = {
  English: "en",
  日本語: "ja",
  한국어: "ko",
};

/**
 * Accessible name of the public site's header language control. It is the
 * control's own label followed by the current autonym, and the label itself is
 * translated, so the name to click depends on the language already on screen.
 */
const HOST_SWITCHER_TRIGGER: Record<LocaleLabel, string> = {
  English: "Language: English",
  日本語: "表示言語: 日本語",
  한국어: "표시 언어: 한국어",
};

/** The same control in the two consoles, where that label is worded differently. */
const CONSOLE_SWITCHER_TRIGGER: Record<LocaleLabel, string> = {
  English: "Display language: English",
  日本語: "表示言語: 日本語",
  한국어: "표시 언어: 한국어",
};

/**
 * Open a language popover and leave it open.
 *
 * The control streams into a header that is otherwise a static shell, so a
 * click can land on markup React has not hydrated yet and do nothing at all.
 * The trigger is pressed again only while the menu is still closed, which is
 * what keeps a retry from toggling one that did open.
 */
const openLocaleMenu = async (
  trigger: Locator,
  option: Locator
): Promise<void> => {
  await expect(async () => {
    if (!(await option.isVisible())) {
      await trigger.click();
    }
    await expect(option).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 15_000 });
};

/**
 * Pick a language from the public site's header control.
 *
 * Each option is a real link there — the locale is in the URL — so this is a
 * navigation, not a form submission.
 */
export const switchHostLocale = async (
  page: Page,
  from: LocaleLabel,
  to: LocaleLabel
): Promise<void> => {
  const option = page.getByRole("link", { exact: true, name: to });
  await openLocaleMenu(
    page.getByRole("button", { name: HOST_SWITCHER_TRIGGER[from] }),
    option
  );
  await option.click();
};

/**
 * Pick a language from a console's header control.
 *
 * Each option is a submit button there: the console keeps the choice in the
 * `publira_locale` cookie, and the Server Action behind it answers with the
 * re-rendered screen in the same round trip.
 */
export const switchConsoleLocale = async (
  page: Page,
  from: LocaleLabel,
  to: LocaleLabel
): Promise<void> => {
  const option = page.getByRole("button", { exact: true, name: to });
  await openLocaleMenu(
    page.getByRole("button", { name: CONSOLE_SWITCHER_TRIGGER[from] }),
    option
  );
  await option.click();
};

/** `<html lang>`, which the apps write from a script rather than the markup. */
export const expectDocumentLocale = async (
  page: Page,
  label: LocaleLabel
): Promise<void> => {
  await expect(page.locator("html")).toHaveAttribute(
    "lang",
    LOCALE_CODE[label]
  );
};

/** The stored display-language choice, absent until the reader makes one. */
export const storedLocaleCookie = async (
  page: Page
): Promise<string | undefined> => {
  const cookies = await page.context().cookies();
  return cookies.find((cookie) => cookie.name === "publira_locale")?.value;
};

/**
 * The status the server answered the navigation with before the browser
 * followed a redirect, or `undefined` when it was answered directly.
 *
 * `page.goto` reports the final response, so a redirect that stopped happening
 * would otherwise still pass every assertion about what is on screen.
 *
 * `redirectedFrom()` yields one hop, so the chain is walked to its start: what
 * a caller asserts is the answer to the URL it asked for, not the last hop of
 * however many the browser then followed.
 */
export const redirectStatus = async (
  response: Response | null
): Promise<number | undefined> => {
  let first = response?.request().redirectedFrom();
  if (!first) {
    return undefined;
  }

  let earlier = first.redirectedFrom();
  while (earlier) {
    first = earlier;
    earlier = first.redirectedFrom();
  }

  const firstResponse = await first.response();
  return firstResponse?.status();
};
