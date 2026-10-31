import { expect, test } from "@playwright/test";

import { applyScenarioSql } from "../src/db";
import {
  expectDocumentLocale,
  openStorefrontLocaleMenu,
  redirectStatus,
  switchStorefrontLocale,
} from "../src/locale";
import {
  BILINGUAL_TENANT,
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

/**
 * A series and its episodes carry a title per language, and the page reads the
 * one written for the language in the URL. The bilingual tenant's default is
 * Japanese, so its unprefixed URL reads the Japanese translation and `/en`
 * reads the English one where the work has it.
 */
test.describe("web-storefront series titles in the reader's language", () => {
  const { translated, untranslated } = BILINGUAL_TENANT;

  test.beforeAll(() => {
    applyScenarioSql(LOCALE_SWITCHING_SCENARIO);
  });

  test("the header switcher changes a series' title with the language", async ({
    page,
  }) => {
    await page.goto(
      bilingualUrl(storefrontPath(`/series/${translated.publicId}`))
    );

    await expect(
      page.getByRole("heading", { level: 1, name: translated.japaneseTitle })
    ).toBeVisible();
    await expect(page.getByText(translated.japaneseSynopsis)).toBeVisible();
    await expect(
      page.getByText(translated.episode.japaneseTitle, { exact: true })
    ).toBeVisible();

    await switchStorefrontLocale(page, "日本語", "English");

    await expect(page).toHaveURL(
      (url) =>
        url.pathname ===
        localeStorefrontPath("en", `/series/${translated.publicId}`)
    );
    await expect(
      page.getByRole("heading", {
        exact: true,
        level: 1,
        name: translated.englishTitle,
      })
    ).toBeVisible();
    await expect(page.getByText(translated.englishSynopsis)).toBeVisible();
    await expect(
      page.getByText(translated.episode.englishTitle, { exact: true })
    ).toBeVisible();
    await expect(
      page.getByRole("main").getByText(translated.japaneseTitle)
    ).toHaveCount(0);
    await expect(
      page.getByText("This series has no title or synopsis")
    ).toHaveCount(0);
    // Metadata can stream in after the body, so the title is polled for.
    await expect.poll(() => page.title()).toContain(translated.englishTitle);
    expect(await page.title()).not.toContain(translated.japaneseTitle);
    await expect(page.locator('meta[property="og:title"]')).toHaveAttribute(
      "content",
      translated.englishTitle
    );
  });

  test("an episode is titled in the reader's language", async ({ page }) => {
    await page.goto(
      bilingualUrl(
        localeStorefrontPath(
          "en",
          `/series/${translated.publicId}/episodes/${translated.episode.publicId}`
        )
      )
    );

    const heading = page.getByRole("heading", { level: 1 });
    await expect(heading).toContainText(translated.episode.englishTitle);
    await expect(heading).not.toContainText(translated.episode.japaneseTitle);
    await expect
      .poll(() => page.title())
      .toContain(translated.episode.englishTitle);
    expect(await page.title()).not.toContain(translated.episode.japaneseTitle);
  });

  test("a series with no title in the reader's language shows the default's and says so", async ({
    page,
  }) => {
    await page.goto(
      bilingualUrl(
        localeStorefrontPath("en", `/series/${untranslated.publicId}`)
      )
    );
    await expectDocumentLocale(page, "English");

    const heading = page.getByRole("heading", {
      level: 1,
      name: untranslated.japaneseTitle,
    });

    await expect(heading).toBeVisible();
    await expect(heading).toHaveAttribute("lang", "ja");
    await expect(
      page.getByText(
        "This series has no title or synopsis in your language, so it is shown in 日本語."
      )
    ).toBeVisible();
    await expect.poll(() => page.title()).toContain(untranslated.japaneseTitle);
    await expect(page.locator('meta[property="og:title"]')).toHaveAttribute(
      "content",
      untranslated.japaneseTitle
    );

    // In its own language the series needs no note.
    await page.goto(
      bilingualUrl(storefrontPath(`/series/${untranslated.publicId}`))
    );
    await expect(
      page.getByRole("heading", { level: 1, name: untranslated.japaneseTitle })
    ).toBeVisible();
    await expect(page.getByText("このシリーズはお使いの言語")).toHaveCount(0);
  });
});

/**
 * A genre carries a name per language, and every place the site names it reads
 * the one written for the language in the URL, else the tenant default's. Its
 * URL is the same in every language: only the prefix changes.
 */
test.describe("web-storefront genre names in the reader's language", () => {
  const { translated, untranslated } = BILINGUAL_TENANT.genres;

  test.beforeAll(() => {
    applyScenarioSql(LOCALE_SWITCHING_SCENARIO);
  });

  test("the header switcher changes a genre's name with the language", async ({
    page,
  }) => {
    const genrePath = `/genres/${translated.publicId}`;

    await page.goto(bilingualUrl(storefrontPath(genrePath)));
    await expect(
      page.getByRole("heading", { level: 1, name: translated.japaneseName })
    ).toBeVisible();

    await switchStorefrontLocale(page, "日本語", "English");

    await expect(page).toHaveURL(
      (url) => url.pathname === localeStorefrontPath("en", genrePath)
    );

    const heading = page.getByRole("heading", {
      exact: true,
      level: 1,
      name: translated.englishName,
    });

    await expect(heading).toBeVisible();
    await expect(heading).toHaveAttribute("lang", "en");
    await expect(
      page.getByRole("main").getByText(translated.japaneseName)
    ).toHaveCount(0);
    await expect.poll(() => page.title()).toContain(translated.englishName);
    expect(await page.title()).not.toContain(translated.japaneseName);
  });

  test("a genre with no name in the reader's language shows the default's", async ({
    page,
  }) => {
    await page.goto(
      bilingualUrl(
        localeStorefrontPath("en", `/genres/${untranslated.publicId}`)
      )
    );
    await expectDocumentLocale(page, "English");

    const heading = page.getByRole("heading", {
      level: 1,
      name: untranslated.japaneseName,
    });

    await expect(heading).toBeVisible();
    await expect(heading).toHaveAttribute("lang", "ja");
    await expect.poll(() => page.title()).toContain(untranslated.japaneseName);
  });

  test("the genre list names each genre in the reader's language", async ({
    page,
  }) => {
    await page.goto(bilingualUrl(localeStorefrontPath("en", "/genres")));

    const main = page.getByRole("main");
    await expect(
      main.getByRole("link", { name: translated.englishName })
    ).toHaveAttribute(
      "href",
      localeStorefrontPath("en", `/genres/${translated.publicId}`)
    );
    await expect(
      main.getByRole("link", { name: untranslated.japaneseName })
    ).toHaveAttribute(
      "href",
      localeStorefrontPath("en", `/genres/${untranslated.publicId}`)
    );
    await expect(main.getByText(translated.japaneseName)).toHaveCount(0);
  });

  test("a series names its genres in the reader's language", async ({
    page,
  }) => {
    const seriesPath = `/series/${BILINGUAL_TENANT.translated.publicId}`;

    const badge = (name: string) =>
      page.getByRole("main").getByRole("link", { exact: true, name });

    await page.goto(bilingualUrl(storefrontPath(seriesPath)));
    await expect(badge(translated.japaneseName)).toHaveAttribute(
      "href",
      storefrontPath(`/genres/${translated.publicId}`)
    );

    await page.goto(bilingualUrl(localeStorefrontPath("en", seriesPath)));
    const english = badge(translated.englishName);
    await expect(english).toHaveAttribute(
      "href",
      localeStorefrontPath("en", `/genres/${translated.publicId}`)
    );
    await expect(english).toHaveAttribute("lang", "en");
    await expect(badge(translated.japaneseName)).toHaveCount(0);
  });
});

/**
 * An announcement is read in the language in the URL where it was written in
 * it, and in the tenant's default otherwise, with a note saying so. The
 * bilingual tenant's two announcements are read without a session, as any
 * visitor reads them.
 */
test.describe("web-storefront announcements in the reader's language", () => {
  const { translated, untranslated } = BILINGUAL_TENANT.announcements;

  test.beforeAll(() => {
    applyScenarioSql(LOCALE_SWITCHING_SCENARIO);
  });

  test("the header switcher changes an announcement's title with the language", async ({
    page,
  }) => {
    await page.goto(
      bilingualUrl(storefrontPath(`/announcements/${translated.id}`))
    );

    await expect(
      page.getByRole("heading", { level: 1, name: translated.japaneseTitle })
    ).toBeVisible();
    await expect(page.getByText(translated.japaneseBody)).toBeVisible();

    await switchStorefrontLocale(page, "日本語", "English");

    await expect(page).toHaveURL(
      (url) =>
        url.pathname ===
        localeStorefrontPath("en", `/announcements/${translated.id}`)
    );

    const heading = page.getByRole("heading", {
      exact: true,
      level: 1,
      name: translated.englishTitle,
    });

    await expect(heading).toBeVisible();
    await expect(heading).toHaveAttribute("lang", "en");
    await expect(page.getByText(translated.englishBody)).toBeVisible();
    await expect(
      page.getByRole("main").getByText(translated.japaneseTitle)
    ).toHaveCount(0);
    await expect(
      page.getByText("This announcement is not written in your language")
    ).toHaveCount(0);
    await expect.poll(() => page.title()).toContain(translated.englishTitle);
  });

  test("an announcement with no translation in the reader's language shows the default's and says so", async ({
    page,
  }) => {
    await page.goto(
      bilingualUrl(
        localeStorefrontPath("en", `/announcements/${untranslated.id}`)
      )
    );
    await expectDocumentLocale(page, "English");

    const heading = page.getByRole("heading", {
      level: 1,
      name: untranslated.japaneseTitle,
    });

    await expect(heading).toBeVisible();
    await expect(heading).toHaveAttribute("lang", "ja");
    await expect(page.getByText(untranslated.japaneseBody)).toBeVisible();
    await expect(
      page.getByText(
        "This announcement is not written in your language, so it is shown in 日本語."
      )
    ).toBeVisible();

    // In its own language the announcement needs no note.
    await page.goto(
      bilingualUrl(storefrontPath(`/announcements/${untranslated.id}`))
    );
    await expect(
      page.getByRole("heading", { level: 1, name: untranslated.japaneseTitle })
    ).toBeVisible();
    await expect(page.getByText("このお知らせはお使いの言語")).toHaveCount(0);
  });

  test("the list shows each announcement in the reader's language and opens it", async ({
    page,
  }) => {
    await page.goto(bilingualUrl(localeStorefrontPath("en", "/announcements")));

    const englishTitle = page.getByRole("heading", {
      exact: true,
      level: 3,
      name: translated.englishTitle,
    });

    await expect(englishTitle).toBeVisible();
    await expect(
      page.getByRole("heading", { level: 3, name: untranslated.japaneseTitle })
    ).toBeVisible();
    await expect(
      page.getByText(
        "This announcement is not written in your language, so it is shown in 日本語."
      )
    ).toHaveCount(1);
    await expect(
      page.getByRole("main").getByText(translated.japaneseTitle)
    ).toHaveCount(0);

    await englishTitle.getByRole("link").click();

    await expect(page).toHaveURL(
      (url) =>
        url.pathname ===
        localeStorefrontPath("en", `/announcements/${translated.id}`)
    );
    await expect(
      page.getByRole("heading", { level: 1, name: translated.englishTitle })
    ).toBeVisible();
  });
});

/**
 * The copy a tenant writes about its site — the description its metadata and
 * footer carry, and its copyright line — is read in the language in the URL,
 * else in the tenant's default. The bilingual tenant writes it in both of its
 * languages; the Japanese-default tenant in Japanese alone.
 */
test.describe("web-storefront site copy in the reader's language", () => {
  test.beforeAll(() => {
    applyScenarioSql(LOCALE_SWITCHING_SCENARIO);
  });

  test("the header switcher changes the footer and the description with the language", async ({
    page,
  }) => {
    const { englishCopy, japaneseCopy } = BILINGUAL_TENANT;
    const footer = page.getByRole("contentinfo");
    const description = page.locator('meta[name="description"]');

    await page.goto(bilingualUrl(storefrontPath("/series")));
    await expect(
      footer.getByText(japaneseCopy.copyrightText, { exact: true })
    ).toBeVisible();
    await expect(
      footer.getByText(japaneseCopy.siteDescription, { exact: true })
    ).toBeVisible();
    await expect(description).toHaveAttribute(
      "content",
      japaneseCopy.siteDescription
    );

    await switchStorefrontLocale(page, "日本語", "English");

    await expect(page).toHaveURL(
      (url) => url.pathname === localeStorefrontPath("en", "/series")
    );
    await expect(
      footer.getByText(englishCopy.copyrightText, { exact: true })
    ).toBeVisible();
    await expect(
      footer.getByText(englishCopy.siteDescription, { exact: true })
    ).toBeVisible();
    await expect(
      footer.getByText(japaneseCopy.copyrightText, { exact: true })
    ).toHaveCount(0);
    await expect(description).toHaveAttribute(
      "content",
      englishCopy.siteDescription
    );
    await expect(
      page.locator('meta[property="og:description"]')
    ).toHaveAttribute("content", englishCopy.siteDescription);
  });

  test("a language the tenant has written no copy in reads the default's", async ({
    page,
  }) => {
    const { japaneseCopy } = JAPANESE_DEFAULT_TENANT;

    await page.goto(japaneseDefaultUrl(localeStorefrontPath("en", "/series")));
    await expect(
      page.getByRole("heading", { level: 1, name: "Series" })
    ).toBeVisible();

    await expect(
      page
        .getByRole("contentinfo")
        .getByText(japaneseCopy.copyrightText, { exact: true })
    ).toBeVisible();
    await expect(page.locator('meta[name="description"]')).toHaveAttribute(
      "content",
      japaneseCopy.siteDescription
    );
  });
});
