import { expect, test } from "@playwright/test";

import { applyScenarioSql } from "../src/db";
import {
  expectDocumentLocale,
  openStorefrontLocaleMenu,
  redirectStatus,
  switchStorefrontLocale,
} from "../src/locale";
import {
  JAPANESE_DEFAULT_TENANT,
  LOCALE_SWITCHING_SCENARIO,
} from "../src/scenarios/locale-switching";
import {
  storefrontPath,
  localeStorefrontPath,
  WEB_STOREFRONT_BILINGUAL_BASE_URL,
  WEB_STOREFRONT_JAPANESE_DEFAULT_BASE_URL,
} from "../src/urls";

/** A parameter no route reads, so it can ride along anywhere. */
const CARRIED_QUERY = "?ref=locale-e2e";

/** Same site, on the Host that resolves to the Japanese-default tenant. */
const japaneseDefaultUrl = (pathname: string): string =>
  `${WEB_STOREFRONT_JAPANESE_DEFAULT_BASE_URL}${pathname}`;

/** Same site, on the Host of the tenant that offers Japanese and English alone. */
const bilingualUrl = (pathname: string): string =>
  `${WEB_STOREFRONT_BILINGUAL_BASE_URL}${pathname}`;

/**
 * The public site puts the locale in the URL: the tenant's own default is
 * served with no prefix, every other locale keeps one, and the header control
 * is the reader's way between them.
 *
 * `proxy.test.ts` covers the same arithmetic against a mocked request. What
 * only a running stack can show is that the tenant a Host resolves to is what
 * decides which locale goes unprefixed — which is why the suite reads two
 * tenants with different saved defaults rather than one.
 *
 * `<html lang>` is asserted on every navigation, not only the ones that carry a
 * document of their own: the attribute is written by a script that runs once
 * per document, so a client-side move is exactly where it can go missing.
 */
test.describe("web-storefront locale in the URL", () => {
  test("the header switcher lands on the same page in the other language", async ({
    page,
  }) => {
    await page.goto(storefrontPath("/series"));
    await expect(
      page.getByRole("heading", { level: 1, name: "Series" })
    ).toBeVisible();
    await expectDocumentLocale(page, "English");

    await switchStorefrontLocale(page, "English", "日本語");

    await expect(page).toHaveURL(
      (url) => url.pathname === localeStorefrontPath("ja", "/series")
    );
    await expect(
      page.getByRole("heading", { level: 1, name: "シリーズ一覧" })
    ).toBeVisible();
    await expectDocumentLocale(page, "日本語");

    await switchStorefrontLocale(page, "日本語", "English");

    await expect(page).toHaveURL(
      (url) => url.pathname === storefrontPath("/series")
    );
    await expect(
      page.getByRole("heading", { level: 1, name: "Series" })
    ).toBeVisible();
    await expectDocumentLocale(page, "English");
  });

  test("the document language survives a move between pages in one language", async ({
    page,
  }) => {
    await page.goto(storefrontPath("/series"));
    await expect(
      page.getByRole("heading", { level: 1, name: "Series" })
    ).toBeVisible();

    // Through the switcher, so what follows starts from a header that is
    // hydrated: an unhydrated `next/link` is a plain anchor, and the fresh
    // document it fetches would run the script that writes the attribute.
    await switchStorefrontLocale(page, "English", "日本語");
    await expect(page).toHaveURL(
      (url) => url.pathname === localeStorefrontPath("ja", "/series")
    );
    await expectDocumentLocale(page, "日本語");

    await page.getByRole("link", { exact: true, name: "レーベル" }).click();

    await expect(page).toHaveURL(
      (url) => url.pathname === localeStorefrontPath("ja", "/labels")
    );
    await expectDocumentLocale(page, "日本語");
  });

  test("the header switcher does not carry the query string over", async ({
    page,
  }) => {
    await page.goto(storefrontPath(`/series${CARRIED_QUERY}`));
    await expect(
      page.getByRole("heading", { level: 1, name: "Series" })
    ).toBeVisible();

    await switchStorefrontLocale(page, "English", "日本語");

    // Documented behaviour: the target is the same page unfiltered, and
    // reading the query would cost the switcher its static shell.
    await expect(page).toHaveURL(
      (url) =>
        url.pathname === localeStorefrontPath("ja", "/series") &&
        url.search === ""
    );
  });

  test("spelling out the tenant default redirects to the unprefixed URL", async ({
    page,
  }) => {
    const response = await page.goto(
      localeStorefrontPath("en", `/series${CARRIED_QUERY}`)
    );

    expect(await redirectStatus(response)).toBe(307);
    await expect(page).toHaveURL(
      (url) =>
        url.pathname === storefrontPath("/series") &&
        url.search === CARRIED_QUERY
    );
    await expect(
      page.getByRole("heading", { level: 1, name: "Series" })
    ).toBeVisible();
  });

  test("a non-default locale keeps its prefix and renders that language", async ({
    page,
  }) => {
    const response = await page.goto(localeStorefrontPath("ja", "/series"));

    expect(response?.status(), await page.content()).toBe(200);
    expect(await redirectStatus(response)).toBeUndefined();
    await expect(
      page.getByRole("heading", { level: 1, name: "シリーズ一覧" })
    ).toBeVisible();
    await expect(
      page.getByRole("link", { exact: true, name: "レーベル" })
    ).toBeVisible();
    await expectDocumentLocale(page, "日本語");
  });

  // The prefix rules name no language, so a catalog added to the registry has
  // to reach the site through the same switcher and the same URL shape as the
  // ones that were there first.
  test("Korean is reached through the switcher and keeps its prefix", async ({
    page,
  }) => {
    await page.goto(storefrontPath("/series"));
    await expect(
      page.getByRole("heading", { level: 1, name: "Series" })
    ).toBeVisible();

    await switchStorefrontLocale(page, "English", "한국어");

    await expect(page).toHaveURL(
      (url) => url.pathname === localeStorefrontPath("ko", "/series")
    );
    await expect(
      page.getByRole("heading", { level: 1, name: "시리즈 목록" })
    ).toBeVisible();
    await expectDocumentLocale(page, "한국어");
  });

  test("Simplified Chinese is reached through the switcher and keeps its prefix", async ({
    page,
  }) => {
    await page.goto(storefrontPath("/series"));
    await expect(
      page.getByRole("heading", { level: 1, name: "Series" })
    ).toBeVisible();

    await switchStorefrontLocale(page, "English", "简体中文");

    // One of the two registry codes carrying a subtag, so this is also what
    // proves a prefix that is not a bare language survives the switcher and
    // the URL.
    await expect(page).toHaveURL(
      (url) => url.pathname === localeStorefrontPath("zh-Hans", "/series")
    );
    await expect(
      page.getByRole("heading", { level: 1, name: "系列" })
    ).toBeVisible();
    await expectDocumentLocale(page, "简体中文");
  });

  test("Traditional Chinese is reached through the switcher and keeps its prefix", async ({
    page,
  }) => {
    await page.goto(storefrontPath("/series"));
    await expect(
      page.getByRole("heading", { level: 1, name: "Series" })
    ).toBeVisible();

    await switchStorefrontLocale(page, "English", "繁體中文");

    // It shares its language with Simplified Chinese and differs only in
    // script, so the prefix landing on `zh-Hant` is what proves the whole code
    // reaches the URL rather than the language it starts with.
    await expect(page).toHaveURL(
      (url) => url.pathname === localeStorefrontPath("zh-Hant", "/series")
    );
    await expect(
      page.getByRole("heading", { level: 1, name: "系列" })
    ).toBeVisible();
    await expectDocumentLocale(page, "繁體中文");
  });

  test("a locale the site does not serve reaches no page at all", async ({
    page,
  }) => {
    // `/fr` is not a locale, so nothing strips it: the path is looked up as a
    // published page slug under the tenant default and no page owns it.
    await page.goto(localeStorefrontPath("fr", "/series"));

    await expect(
      page.getByRole("heading", { level: 1, name: "Page not found" })
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { level: 1, name: "Series" })
    ).toHaveCount(0);
  });

  test("a published page resolves under a locale prefix as well as without one", async ({
    page,
  }) => {
    await page.goto(storefrontPath("/privacy"));
    await expect(
      page.getByRole("heading", { level: 1, name: "Privacy policy" })
    ).toBeVisible();
    await expect(
      page.getByText("This page is not published in your language")
    ).toHaveCount(0);
    await expect(
      page.getByRole("link", { exact: true, name: "Labels" })
    ).toBeVisible();

    await page.goto(localeStorefrontPath("ja", "/privacy"));
    await expect(
      page.getByRole("link", { exact: true, name: "レーベル" })
    ).toBeVisible();
    await expectDocumentLocale(page, "日本語");
    // The site chrome is Japanese. The tenant has not published a Japanese
    // translation, so the page stays the English one and says so.
    await expect(
      page.getByRole("heading", { level: 1, name: "Privacy policy" })
    ).toBeVisible();
    await expect(page.locator("article")).toHaveAttribute("lang", "en");
    await expect(
      page.getByText(
        "このページはお使いの言語では公開されていないため、Englishで表示しています。"
      )
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Privacy policy" })
    ).toBeVisible();
  });
});

/**
 * The mirror image, on a tenant that saved `ja`. Nothing about the prefix rules
 * names a language: the unprefixed URL is whatever the tenant stored, and the
 * redirect and the surviving prefix swap sides with it.
 */
test.describe("web-storefront locale on a tenant whose default is Japanese", () => {
  test.beforeAll(() => {
    applyScenarioSql(LOCALE_SWITCHING_SCENARIO);
  });

  test("the tenant's own default is served without a prefix", async ({
    page,
  }) => {
    const response = await page.goto(
      japaneseDefaultUrl(storefrontPath("/series"))
    );

    expect(response?.status(), await page.content()).toBe(200);
    expect(await redirectStatus(response)).toBeUndefined();
    await expect(
      page.getByRole("heading", { level: 1, name: "シリーズ一覧" })
    ).toBeVisible();
    await expect(
      page.getByText("シリーズはまだ登録されていません。")
    ).toBeVisible();
    await expectDocumentLocale(page, "日本語");
    // The sentence is this build's copy; the name inside it is the tenant's,
    // and it reads the same in either language.
    await expect(
      page.getByText(`${JAPANESE_DEFAULT_TENANT.name}に登録されている`)
    ).toBeVisible();
  });

  test("spelling out that tenant's default redirects, and English keeps its prefix", async ({
    page,
  }) => {
    const redirected = await page.goto(
      japaneseDefaultUrl(localeStorefrontPath("ja", `/series${CARRIED_QUERY}`))
    );

    expect(await redirectStatus(redirected)).toBe(307);
    await expect(page).toHaveURL(
      (url) =>
        url.pathname === storefrontPath("/series") &&
        url.search === CARRIED_QUERY
    );
    await expect(
      page.getByRole("heading", { level: 1, name: "シリーズ一覧" })
    ).toBeVisible();

    const prefixed = await page.goto(
      japaneseDefaultUrl(localeStorefrontPath("en", "/series"))
    );

    expect(await redirectStatus(prefixed)).toBeUndefined();
    await expect(
      page.getByRole("heading", { level: 1, name: "Series" })
    ).toBeVisible();
    await expectDocumentLocale(page, "English");
  });

  test("the header switcher swaps to the prefixed locale and back", async ({
    page,
  }) => {
    await page.goto(japaneseDefaultUrl(storefrontPath("/")));
    await expect(
      page.getByRole("heading", { level: 2, name: "新着エピソード" })
    ).toBeVisible();

    await switchStorefrontLocale(page, "日本語", "English");

    await expect(page).toHaveURL(
      (url) => url.pathname === localeStorefrontPath("en", "/")
    );
    await expect(
      page.getByRole("heading", { level: 2, name: "New episodes" })
    ).toBeVisible();
    await expectDocumentLocale(page, "English");

    await switchStorefrontLocale(page, "English", "日本語");

    await expect(page).toHaveURL((url) => url.pathname === storefrontPath("/"));
    await expect(
      page.getByRole("heading", { level: 2, name: "新着エピソード" })
    ).toBeVisible();
    await expectDocumentLocale(page, "日本語");
  });
});

/**
 * A tenant that offers Japanese and English alone. The prefix rules above hold
 * for the languages it offers; a prefix it does not offer is a language it
 * switched off, and lands on the same page in its default rather than on a
 * 404, so a bookmark from before the switch still opens.
 */
test.describe("web-storefront locale on a tenant that offers two languages", () => {
  test.beforeAll(() => {
    applyScenarioSql(LOCALE_SWITCHING_SCENARIO);
  });

  test("a language the tenant does not offer redirects to the unprefixed URL", async ({
    page,
  }) => {
    const response = await page.goto(
      bilingualUrl(localeStorefrontPath("ko", `/series${CARRIED_QUERY}`))
    );

    expect(await redirectStatus(response)).toBe(307);
    await expect(page).toHaveURL(
      (url) =>
        url.pathname === storefrontPath("/series") &&
        url.search === CARRIED_QUERY
    );
    await expect(
      page.getByRole("heading", { level: 1, name: "シリーズ一覧" })
    ).toBeVisible();
    await expectDocumentLocale(page, "日本語");
  });

  test("a language the tenant offers keeps its prefix", async ({ page }) => {
    const response = await page.goto(
      bilingualUrl(localeStorefrontPath("en", "/series"))
    );

    expect(response?.status(), await page.content()).toBe(200);
    expect(await redirectStatus(response)).toBeUndefined();
    await expect(
      page.getByRole("heading", { level: 1, name: "Series" })
    ).toBeVisible();
    await expectDocumentLocale(page, "English");
  });

  test("the header switcher lists only the languages the tenant offers", async ({
    page,
  }) => {
    await page.goto(bilingualUrl(storefrontPath("/series")));
    await expect(
      page.getByRole("heading", { level: 1, name: "シリーズ一覧" })
    ).toBeVisible();

    const english = await openStorefrontLocaleMenu(page, "日本語", "English");
    const menu = page.getByRole("dialog", { name: "表示言語" });

    await expect(menu.getByRole("link")).toHaveText(["日本語", "English"]);

    await english.click();
    await expect(page).toHaveURL(
      (url) => url.pathname === localeStorefrontPath("en", "/series")
    );
    await expect(
      page.getByRole("heading", { level: 1, name: "Series" })
    ).toBeVisible();
  });
});
