import { expect, test } from "@playwright/test";

import { applyScenarioSql } from "../src/db";
import {
  expectDocumentLocale,
  redirectStatus,
  switchHostLocale,
} from "../src/locale";
import {
  JAPANESE_DEFAULT_TENANT,
  LOCALE_SWITCHING_SCENARIO,
} from "../src/scenarios/locale-switching";
import {
  hostPath,
  localeHostPath,
  WEB_HOST_JAPANESE_DEFAULT_BASE_URL,
} from "../src/urls";

/** A parameter no route reads, so it can ride along anywhere. */
const CARRIED_QUERY = "?ref=locale-e2e";

/** Same site, on the Host that resolves to the Japanese-default tenant. */
const japaneseDefaultUrl = (pathname: string): string =>
  `${WEB_HOST_JAPANESE_DEFAULT_BASE_URL}${pathname}`;

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
test.describe("web-host locale in the URL", () => {
  test("the header switcher lands on the same page in the other language", async ({
    page,
  }) => {
    await page.goto(hostPath("/series"));
    await expect(
      page.getByRole("heading", { level: 1, name: "Series" })
    ).toBeVisible();
    await expectDocumentLocale(page, "English");

    await switchHostLocale(page, "English", "日本語");

    await expect(page).toHaveURL(
      (url) => url.pathname === localeHostPath("ja", "/series")
    );
    await expect(
      page.getByRole("heading", { level: 1, name: "シリーズ一覧" })
    ).toBeVisible();
    await expectDocumentLocale(page, "日本語");

    await switchHostLocale(page, "日本語", "English");

    await expect(page).toHaveURL((url) => url.pathname === hostPath("/series"));
    await expect(
      page.getByRole("heading", { level: 1, name: "Series" })
    ).toBeVisible();
    await expectDocumentLocale(page, "English");
  });

  test("the document language survives a move between pages in one language", async ({
    page,
  }) => {
    await page.goto(hostPath("/series"));
    await expect(
      page.getByRole("heading", { level: 1, name: "Series" })
    ).toBeVisible();

    // Through the switcher, so what follows starts from a header that is
    // hydrated: an unhydrated `next/link` is a plain anchor, and the fresh
    // document it fetches would run the script that writes the attribute.
    await switchHostLocale(page, "English", "日本語");
    await expect(page).toHaveURL(
      (url) => url.pathname === localeHostPath("ja", "/series")
    );
    await expectDocumentLocale(page, "日本語");

    await page.getByRole("link", { exact: true, name: "レーベル" }).click();

    await expect(page).toHaveURL(
      (url) => url.pathname === localeHostPath("ja", "/labels")
    );
    await expectDocumentLocale(page, "日本語");
  });

  test("the header switcher does not carry the query string over", async ({
    page,
  }) => {
    await page.goto(hostPath(`/series${CARRIED_QUERY}`));
    await expect(
      page.getByRole("heading", { level: 1, name: "Series" })
    ).toBeVisible();

    await switchHostLocale(page, "English", "日本語");

    // Documented behaviour: the target is the same page unfiltered, and
    // reading the query would cost the switcher its static shell.
    await expect(page).toHaveURL(
      (url) =>
        url.pathname === localeHostPath("ja", "/series") && url.search === ""
    );
  });

  test("spelling out the tenant default redirects to the unprefixed URL", async ({
    page,
  }) => {
    const response = await page.goto(
      localeHostPath("en", `/series${CARRIED_QUERY}`)
    );

    expect(await redirectStatus(response)).toBe(307);
    await expect(page).toHaveURL(
      (url) =>
        url.pathname === hostPath("/series") && url.search === CARRIED_QUERY
    );
    await expect(
      page.getByRole("heading", { level: 1, name: "Series" })
    ).toBeVisible();
  });

  test("a non-default locale keeps its prefix and renders that language", async ({
    page,
  }) => {
    const response = await page.goto(localeHostPath("ja", "/series"));

    expect(response?.status(), await page.content()).toBe(200);
    expect(await redirectStatus(response)).toBeUndefined();
    await expect(
      page.getByRole("heading", { level: 1, name: "シリーズ一覧" })
    ).toBeVisible();
    await expect(
      page.getByRole("link", { exact: true, name: "シリーズ" })
    ).toBeVisible();
    await expectDocumentLocale(page, "日本語");
  });

  // The prefix rules name no language, so a catalog added to the registry has
  // to reach the site through the same switcher and the same URL shape as the
  // ones that were there first.
  test("Korean is reached through the switcher and keeps its prefix", async ({
    page,
  }) => {
    await page.goto(hostPath("/series"));
    await expect(
      page.getByRole("heading", { level: 1, name: "Series" })
    ).toBeVisible();

    await switchHostLocale(page, "English", "한국어");

    await expect(page).toHaveURL(
      (url) => url.pathname === localeHostPath("ko", "/series")
    );
    await expect(
      page.getByRole("heading", { level: 1, name: "시리즈 목록" })
    ).toBeVisible();
    await expectDocumentLocale(page, "한국어");
  });

  test("a locale the site does not serve reaches no page at all", async ({
    page,
  }) => {
    // `/fr` is not a locale, so nothing strips it: the path is looked up as a
    // published page slug under the tenant default and no page owns it. The
    // response is HTTP 200 for the reason `catalog.not-found.spec.ts` records —
    // the record is read inside `<Suspense>`, after the shell has committed.
    await page.goto(localeHostPath("fr", "/series"));

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
    await page.goto(hostPath("/privacy"));
    await expect(
      page.getByRole("heading", { level: 1, name: "Privacy policy" })
    ).toBeVisible();
    await expect(
      page.getByRole("link", { exact: true, name: "Series" })
    ).toBeVisible();

    await page.goto(localeHostPath("ja", "/privacy"));
    await expect(
      page.getByRole("link", { exact: true, name: "シリーズ" })
    ).toBeVisible();
    await expectDocumentLocale(page, "日本語");
    // The site chrome is Japanese; what the tenant wrote is not translated, and
    // a build that started translating it would fail here.
    await expect(
      page.getByRole("heading", { level: 1, name: "Privacy policy" })
    ).toBeVisible();
  });
});

/**
 * The mirror image, on a tenant that saved `ja`. Nothing about the prefix rules
 * names a language: the unprefixed URL is whatever the tenant stored, and the
 * redirect and the surviving prefix swap sides with it.
 */
test.describe("web-host locale on a tenant whose default is Japanese", () => {
  test.beforeAll(() => {
    applyScenarioSql(LOCALE_SWITCHING_SCENARIO);
  });

  test("the tenant's own default is served without a prefix", async ({
    page,
  }) => {
    const response = await page.goto(japaneseDefaultUrl(hostPath("/series")));

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
      japaneseDefaultUrl(localeHostPath("ja", `/series${CARRIED_QUERY}`))
    );

    expect(await redirectStatus(redirected)).toBe(307);
    await expect(page).toHaveURL(
      (url) =>
        url.pathname === hostPath("/series") && url.search === CARRIED_QUERY
    );
    await expect(
      page.getByRole("heading", { level: 1, name: "シリーズ一覧" })
    ).toBeVisible();

    const prefixed = await page.goto(
      japaneseDefaultUrl(localeHostPath("en", "/series"))
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
    await page.goto(japaneseDefaultUrl(hostPath("/")));
    await expect(
      page.getByRole("heading", { level: 1, name: "カタログトップ" })
    ).toBeVisible();

    await switchHostLocale(page, "日本語", "English");

    await expect(page).toHaveURL(
      (url) => url.pathname === localeHostPath("en", "/")
    );
    await expect(
      page.getByRole("heading", { level: 1, name: "Catalog" })
    ).toBeVisible();
    await expectDocumentLocale(page, "English");

    await switchHostLocale(page, "English", "日本語");

    await expect(page).toHaveURL((url) => url.pathname === hostPath("/"));
    await expect(
      page.getByRole("heading", { level: 1, name: "カタログトップ" })
    ).toBeVisible();
    await expectDocumentLocale(page, "日本語");
  });
});
