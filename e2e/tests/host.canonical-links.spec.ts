import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import { applyScenarioSql } from "../src/db";
import {
  JAPANESE_DEFAULT_TENANT,
  LOCALE_SWITCHING_SCENARIO,
} from "../src/scenarios/locale-switching";
import { SEED_TENANT } from "../src/scenarios/multi-tenant";
import {
  hostPath,
  localeHostPath,
  WEB_HOST_JAPANESE_DEFAULT_BASE_URL,
} from "../src/urls";

/** The development seed tenant's stored domain, which it publishes under. */
const SEED_ORIGIN = "https://localhost";

const JAPANESE_DEFAULT_ORIGIN = `https://${JAPANESE_DEFAULT_TENANT.domain}`;

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
test.describe("web-host canonical and language alternate links", () => {
  test("a page under a non-default locale is canonical at its own prefixed URL", async ({
    page,
  }) => {
    await page.goto(localeHostPath("ja", `/series${LIST_QUERY}`));

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

  test("the tenant default locale is canonical at the unprefixed URL", async ({
    page,
  }) => {
    const seriesPath = `/series/${SEED_TENANT.series.publicId}`;

    await page.goto(hostPath(seriesPath));

    await expectCanonical(page, `${SEED_ORIGIN}${seriesPath}`);
    await expect(page.locator('meta[property="og:url"]')).toHaveAttribute(
      "content",
      `${SEED_ORIGIN}${seriesPath}`
    );
    await expectLanguageAlternates(page, {
      en: `${SEED_ORIGIN}${seriesPath}`,
      ja: `${SEED_ORIGIN}/ja${seriesPath}`,
      ko: `${SEED_ORIGIN}/ko${seriesPath}`,
      "x-default": `${SEED_ORIGIN}${seriesPath}`,
      "zh-Hans": `${SEED_ORIGIN}/zh-Hans${seriesPath}`,
      "zh-Hant": `${SEED_ORIGIN}/zh-Hant${seriesPath}`,
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
        `${WEB_HOST_JAPANESE_DEFAULT_BASE_URL}${localeHostPath("en", "/")}`
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
