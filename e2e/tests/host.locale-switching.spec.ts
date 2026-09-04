import { expect, test } from "@playwright/test";

import { applyScenarioSql } from "../src/db";
import {
  expectDocumentLocale,
  redirectStatus,
  switchHostLocale,
} from "../src/locale";
import {
  ENGLISH_DEFAULT_TENANT,
  LOCALE_SWITCHING_SCENARIO,
} from "../src/scenarios/locale-switching";
import {
  hostPath,
  localeHostPath,
  WEB_HOST_ENGLISH_DEFAULT_BASE_URL,
} from "../src/urls";

/** A parameter no route reads, so it can ride along anywhere. */
const CARRIED_QUERY = "?ref=locale-e2e";

/** Same site, on the Host that resolves to the English-default tenant. */
const englishDefaultUrl = (pathname: string): string =>
  `${WEB_HOST_ENGLISH_DEFAULT_BASE_URL}${pathname}`;

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
 * `<html lang>` is asserted on the navigations that carry a document of their
 * own. Across a switch it is not, because the attribute goes missing there:
 * https://github.com/publira/publira/issues/1508.
 */
test.describe("web-host locale in the URL", () => {
  test("the header switcher lands on the same page in the other language", async ({
    page,
  }) => {
    await page.goto(hostPath("/series"));
    await expect(
      page.getByRole("heading", { level: 1, name: "シリーズ一覧" })
    ).toBeVisible();
    await expectDocumentLocale(page, "日本語");

    await switchHostLocale(page, "日本語", "English");

    await expect(page).toHaveURL(
      (url) => url.pathname === localeHostPath("en", "/series")
    );
    await expect(
      page.getByRole("heading", { level: 1, name: "Series" })
    ).toBeVisible();

    await switchHostLocale(page, "English", "日本語");

    await expect(page).toHaveURL((url) => url.pathname === hostPath("/series"));
    await expect(
      page.getByRole("heading", { level: 1, name: "シリーズ一覧" })
    ).toBeVisible();
  });

  test("the header switcher does not carry the query string over", async ({
    page,
  }) => {
    await page.goto(hostPath(`/series${CARRIED_QUERY}`));
    await expect(
      page.getByRole("heading", { level: 1, name: "シリーズ一覧" })
    ).toBeVisible();

    await switchHostLocale(page, "日本語", "English");

    // Documented behaviour: the target is the same page unfiltered, and
    // reading the query would cost the switcher its static shell.
    await expect(page).toHaveURL(
      (url) =>
        url.pathname === localeHostPath("en", "/series") && url.search === ""
    );
  });

  test("spelling out the tenant default redirects to the unprefixed URL", async ({
    page,
  }) => {
    const response = await page.goto(
      localeHostPath("ja", `/series${CARRIED_QUERY}`)
    );

    expect(await redirectStatus(response)).toBe(307);
    await expect(page).toHaveURL(
      (url) =>
        url.pathname === hostPath("/series") && url.search === CARRIED_QUERY
    );
    await expect(
      page.getByRole("heading", { level: 1, name: "シリーズ一覧" })
    ).toBeVisible();
  });

  test("a non-default locale keeps its prefix and renders that language", async ({
    page,
  }) => {
    const response = await page.goto(localeHostPath("en", "/series"));

    expect(response?.status(), await page.content()).toBe(200);
    expect(await redirectStatus(response)).toBeUndefined();
    await expect(
      page.getByRole("heading", { level: 1, name: "Series" })
    ).toBeVisible();
    await expect(
      page.getByRole("link", { exact: true, name: "Series" })
    ).toBeVisible();
    await expectDocumentLocale(page, "English");
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
      page.getByRole("heading", { level: 1, name: "ページが見つかりません" })
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { level: 1, name: "シリーズ一覧" })
    ).toHaveCount(0);
  });

  test("a published page resolves under a locale prefix as well as without one", async ({
    page,
  }) => {
    await page.goto(hostPath("/privacy"));
    await expect(
      page.getByRole("heading", { level: 1, name: "プライバシーポリシー" })
    ).toBeVisible();
    await expect(
      page.getByRole("link", { exact: true, name: "シリーズ" })
    ).toBeVisible();

    await page.goto(localeHostPath("en", "/privacy"));
    await expect(
      page.getByRole("link", { exact: true, name: "Series" })
    ).toBeVisible();
    await expectDocumentLocale(page, "English");
    // The site chrome is English; what the tenant wrote is not translated, and
    // a build that started translating it would fail here.
    await expect(
      page.getByRole("heading", { level: 1, name: "プライバシーポリシー" })
    ).toBeVisible();
  });
});

/**
 * The mirror image, on a tenant that saved `en`. Nothing about the prefix rules
 * names a language: the unprefixed URL is whatever the tenant stored, and the
 * redirect and the surviving prefix swap sides with it.
 */
test.describe("web-host locale on a tenant whose default is English", () => {
  test.beforeAll(() => {
    applyScenarioSql(LOCALE_SWITCHING_SCENARIO);
  });

  test("the tenant's own default is served without a prefix", async ({
    page,
  }) => {
    const response = await page.goto(englishDefaultUrl(hostPath("/series")));

    expect(response?.status(), await page.content()).toBe(200);
    expect(await redirectStatus(response)).toBeUndefined();
    await expect(
      page.getByRole("heading", { level: 1, name: "Series" })
    ).toBeVisible();
    await expect(
      page.getByText("No series have been registered yet.")
    ).toBeVisible();
    await expectDocumentLocale(page, "English");
    // The sentence is this build's copy; the name inside it is the tenant's,
    // and it reads the same in either language.
    await expect(
      page.getByText(`The series published on ${ENGLISH_DEFAULT_TENANT.name}`)
    ).toBeVisible();
  });

  test("spelling out that tenant's default redirects, and Japanese keeps its prefix", async ({
    page,
  }) => {
    const redirected = await page.goto(
      englishDefaultUrl(localeHostPath("en", `/series${CARRIED_QUERY}`))
    );

    expect(await redirectStatus(redirected)).toBe(307);
    await expect(page).toHaveURL(
      (url) =>
        url.pathname === hostPath("/series") && url.search === CARRIED_QUERY
    );
    await expect(
      page.getByRole("heading", { level: 1, name: "Series" })
    ).toBeVisible();

    const prefixed = await page.goto(
      englishDefaultUrl(localeHostPath("ja", "/series"))
    );

    expect(await redirectStatus(prefixed)).toBeUndefined();
    await expect(
      page.getByRole("heading", { level: 1, name: "シリーズ一覧" })
    ).toBeVisible();
    await expectDocumentLocale(page, "日本語");
  });

  test("the header switcher swaps to the prefixed locale and back", async ({
    page,
  }) => {
    await page.goto(englishDefaultUrl(hostPath("/")));
    await expect(
      page.getByRole("heading", { level: 1, name: "Catalog" })
    ).toBeVisible();

    await switchHostLocale(page, "English", "日本語");

    await expect(page).toHaveURL(
      (url) => url.pathname === localeHostPath("ja", "/")
    );
    await expect(
      page.getByRole("heading", { level: 1, name: "カタログトップ" })
    ).toBeVisible();

    await switchHostLocale(page, "日本語", "English");

    await expect(page).toHaveURL((url) => url.pathname === hostPath("/"));
    await expect(
      page.getByRole("heading", { level: 1, name: "Catalog" })
    ).toBeVisible();
  });
});
