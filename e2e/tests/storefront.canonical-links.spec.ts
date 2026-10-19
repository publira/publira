import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import { applyScenarioSql } from "../src/db";
import {
  BILINGUAL_TENANT,
  JAPANESE_DEFAULT_TENANT,
  LOCALE_SWITCHING_SCENARIO,
} from "../src/scenarios/locale-switching";
import { SEED_TENANT } from "../src/scenarios/multi-tenant";
import {
  storefrontPath,
  localeStorefrontPath,
  tenantHost,
  WEB_STOREFRONT_BILINGUAL_BASE_URL,
  WEB_STOREFRONT_JAPANESE_DEFAULT_BASE_URL,
} from "../src/urls";

/** The development seed tenant's stored domain, which it publishes under. */
/** The stack's edge serves plain HTTP, which `PUBLIRA_TENANT_URL_SCHEME` names. */
const publishedOrigin = (hostname: string): string =>
  `http://${tenantHost(hostname)}`;

const SEED_ORIGIN = publishedOrigin("localhost");

const JAPANESE_DEFAULT_ORIGIN = publishedOrigin(JAPANESE_DEFAULT_TENANT.domain);

const BILINGUAL_ORIGIN = publishedOrigin(BILINGUAL_TENANT.domain);

/** A sort order names a view of the list, not another page. */
const LIST_QUERY = "?order=title";

const expectCanonical = async (page: Page, href: string): Promise<void> => {
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    "href",
    href
  );
};

/** Every supported locale and `x-default`, each at its absolute address. */
const expectLanguageAlternates = async (
  page: Page,
  languages: Record<string, string>
): Promise<void> => {
  await expect(page.locator('link[rel="alternate"][hreflang]')).toHaveCount(
    Object.keys(languages).length
  );
  await Promise.all(
    Object.entries(languages).map(([hreflang, href]) =>
      expect(
        page.locator(`link[rel="alternate"][hreflang="${hreflang}"]`)
      ).toHaveAttribute("href", href)
    )
  );
};

/**
 * Each public page names its own canonical URL on the tenant's stored domain,
 * whatever Host it was reached on, and the same page in every other locale.
 * The development seed tenant's default is English; the scenario tenant's is
 * Japanese, which is what shows that the tenant decides which locale is
 * unprefixed.
 */
test.describe("web-storefront canonical and language alternate links", () => {
  test("a page under a non-default locale is canonical at its own prefixed URL", async ({
    page,
  }) => {
    await page.goto(localeStorefrontPath("ja", `/series${LIST_QUERY}`));

    await expectCanonical(page, `${SEED_ORIGIN}/ja/series`);
    await expectLanguageAlternates(page, {
      en: `${SEED_ORIGIN}/series`,
      ja: `${SEED_ORIGIN}/ja/series`,
      ko: `${SEED_ORIGIN}/ko/series`,
      "x-default": `${SEED_ORIGIN}/series`,
      "zh-Hans": `${SEED_ORIGIN}/zh-Hans/series`,
      "zh-Hant": `${SEED_ORIGIN}/zh-Hant/series`,
    });
  });

  test("a page published in one language alternates only that language", async ({
    page,
  }) => {
    await page.goto(storefrontPath("/privacy"));

    await expectCanonical(page, `${SEED_ORIGIN}/privacy`);
    await expectLanguageAlternates(page, {
      en: `${SEED_ORIGIN}/privacy`,
      "x-default": `${SEED_ORIGIN}/privacy`,
    });

    // The Japanese URL serves the same English page. It is not a second
    // language, so it points search engines back at the English address.
    await page.goto(localeStorefrontPath("ja", "/privacy"));

    await expectCanonical(page, `${SEED_ORIGIN}/privacy`);
    await expectLanguageAlternates(page, {
      en: `${SEED_ORIGIN}/privacy`,
      "x-default": `${SEED_ORIGIN}/privacy`,
    });
  });

  test("the tenant default locale is canonical at the unprefixed URL", async ({
    page,
  }) => {
    const seriesPath = `/series/${SEED_TENANT.series.publicId}`;

    await page.goto(storefrontPath(seriesPath));

    await expectCanonical(page, `${SEED_ORIGIN}${seriesPath}`);
    await expect(page.locator('meta[property="og:url"]')).toHaveAttribute(
      "content",
      `${SEED_ORIGIN}${seriesPath}`
    );
    // The seed series is written in English alone, so English is the one
    // language of its URL.
    await expectLanguageAlternates(page, {
      en: `${SEED_ORIGIN}${seriesPath}`,
      "x-default": `${SEED_ORIGIN}${seriesPath}`,
    });

    // The Japanese URL shows the same English title, so it points search
    // engines back at the English address, as a page published in one
    // language does.
    await page.goto(localeStorefrontPath("ja", seriesPath));

    await expectCanonical(page, `${SEED_ORIGIN}${seriesPath}`);
    await expectLanguageAlternates(page, {
      en: `${SEED_ORIGIN}${seriesPath}`,
      "x-default": `${SEED_ORIGIN}${seriesPath}`,
    });
  });

  test.describe("on a tenant whose default is Japanese", () => {
    test.beforeAll(() => {
      applyScenarioSql(LOCALE_SWITCHING_SCENARIO);
    });

    test("Japanese is unprefixed and English carries its prefix", async ({
      page,
    }) => {
      await page.goto(
        `${WEB_STOREFRONT_JAPANESE_DEFAULT_BASE_URL}${localeStorefrontPath("en", "/")}`
      );

      await expectCanonical(page, `${JAPANESE_DEFAULT_ORIGIN}/en`);
      await expectLanguageAlternates(page, {
        en: `${JAPANESE_DEFAULT_ORIGIN}/en`,
        ja: JAPANESE_DEFAULT_ORIGIN,
        ko: `${JAPANESE_DEFAULT_ORIGIN}/ko`,
        "x-default": JAPANESE_DEFAULT_ORIGIN,
        "zh-Hans": `${JAPANESE_DEFAULT_ORIGIN}/zh-Hans`,
        "zh-Hant": `${JAPANESE_DEFAULT_ORIGIN}/zh-Hant`,
      });
    });
  });
});

/**
 * A series names as its languages the ones it has a translation in, among the
 * ones the tenant offers. The bilingual tenant offers Japanese, its default,
 * and English.
 */
test.describe("web-storefront language alternates of a series", () => {
  const { translated, untranslated } = BILINGUAL_TENANT;

  test.beforeAll(() => {
    applyScenarioSql(LOCALE_SWITCHING_SCENARIO);
  });

  test("a series written in both languages alternates both", async ({
    page,
  }) => {
    const seriesPath = `/series/${translated.publicId}`;

    await page.goto(
      `${WEB_STOREFRONT_BILINGUAL_BASE_URL}${localeStorefrontPath("en", seriesPath)}`
    );

    await expectCanonical(page, `${BILINGUAL_ORIGIN}/en${seriesPath}`);
    await expectLanguageAlternates(page, {
      en: `${BILINGUAL_ORIGIN}/en${seriesPath}`,
      ja: `${BILINGUAL_ORIGIN}${seriesPath}`,
      "x-default": `${BILINGUAL_ORIGIN}${seriesPath}`,
    });
  });

  test("a series shown in a fallback language is canonical in that language", async ({
    page,
  }) => {
    const seriesPath = `/series/${untranslated.publicId}`;

    await page.goto(
      `${WEB_STOREFRONT_BILINGUAL_BASE_URL}${localeStorefrontPath("en", seriesPath)}`
    );

    await expectCanonical(page, `${BILINGUAL_ORIGIN}${seriesPath}`);
    await expectLanguageAlternates(page, {
      ja: `${BILINGUAL_ORIGIN}${seriesPath}`,
      "x-default": `${BILINGUAL_ORIGIN}${seriesPath}`,
    });
  });
});

/**
 * A genre's page lists the tenant's series under it, in whichever language the
 * reader reads, so it is published in every language the tenant offers at the
 * same path, even where the genre's own name falls back.
 */
test.describe("web-storefront language alternates of a genre", () => {
  const { translated, untranslated } = BILINGUAL_TENANT.genres;

  test.beforeAll(() => {
    applyScenarioSql(LOCALE_SWITCHING_SCENARIO);
  });

  test("a genre named in both languages alternates the same path in both", async ({
    page,
  }) => {
    const genrePath = `/genres/${translated.publicId}`;

    await page.goto(
      `${WEB_STOREFRONT_BILINGUAL_BASE_URL}${localeStorefrontPath("en", genrePath)}`
    );

    await expectCanonical(page, `${BILINGUAL_ORIGIN}/en${genrePath}`);
    await expectLanguageAlternates(page, {
      en: `${BILINGUAL_ORIGIN}/en${genrePath}`,
      ja: `${BILINGUAL_ORIGIN}${genrePath}`,
      "x-default": `${BILINGUAL_ORIGIN}${genrePath}`,
    });
  });

  test("a genre named in the default language alone still alternates both", async ({
    page,
  }) => {
    const genrePath = `/genres/${untranslated.publicId}`;

    await page.goto(
      `${WEB_STOREFRONT_BILINGUAL_BASE_URL}${localeStorefrontPath("en", genrePath)}`
    );

    await expectCanonical(page, `${BILINGUAL_ORIGIN}/en${genrePath}`);
    await expectLanguageAlternates(page, {
      en: `${BILINGUAL_ORIGIN}/en${genrePath}`,
      ja: `${BILINGUAL_ORIGIN}${genrePath}`,
      "x-default": `${BILINGUAL_ORIGIN}${genrePath}`,
    });
  });
});

/**
 * An announcement names as its languages the ones it was written in, among the
 * ones the tenant offers, as a series does.
 */
test.describe("web-storefront language alternates of an announcement", () => {
  const { translated, untranslated } = BILINGUAL_TENANT.announcements;

  test.beforeAll(() => {
    applyScenarioSql(LOCALE_SWITCHING_SCENARIO);
  });

  test("an announcement written in both languages alternates both", async ({
    page,
  }) => {
    const announcementPath = `/announcements/${translated.id}`;

    await page.goto(
      `${WEB_STOREFRONT_BILINGUAL_BASE_URL}${localeStorefrontPath("en", announcementPath)}`
    );

    await expectCanonical(page, `${BILINGUAL_ORIGIN}/en${announcementPath}`);
    await expectLanguageAlternates(page, {
      en: `${BILINGUAL_ORIGIN}/en${announcementPath}`,
      ja: `${BILINGUAL_ORIGIN}${announcementPath}`,
      "x-default": `${BILINGUAL_ORIGIN}${announcementPath}`,
    });
  });

  test("an announcement shown in a fallback language is canonical in that language", async ({
    page,
  }) => {
    const announcementPath = `/announcements/${untranslated.id}`;

    await page.goto(
      `${WEB_STOREFRONT_BILINGUAL_BASE_URL}${localeStorefrontPath("en", announcementPath)}`
    );

    await expectCanonical(page, `${BILINGUAL_ORIGIN}${announcementPath}`);
    await expectLanguageAlternates(page, {
      ja: `${BILINGUAL_ORIGIN}${announcementPath}`,
      "x-default": `${BILINGUAL_ORIGIN}${announcementPath}`,
    });
  });
});
