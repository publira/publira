import { expect, test } from "@playwright/test";

import {
  createEpisodeViaUi,
  createSeriesViaUi,
  signInAsSeedAdmin,
} from "../src/admin";
import { applyScenarioSql, deleteSeriesByPublicIds } from "../src/db";
import {
  nudgeScheduledEpisodeReady,
  waitUntilEpisodePublishedInDb,
} from "../src/publish";
import {
  publishedAtOneHourAgo,
  scheduleAtFiveMinutesFromNow,
  uniqueSuffix,
} from "../src/scenarios/admin-publish";
import {
  BILINGUAL_TENANT,
  LOCALE_SWITCHING_SCENARIO,
} from "../src/scenarios/locale-switching";
import {
  tenantHost,
  WEB_STOREFRONT_BASE_URL,
  WEB_STOREFRONT_BILINGUAL_BASE_URL,
} from "../src/urls";

/** The development seed tenant's stored domain, which it publishes under. */
const SEED_ORIGIN = `http://${tenantHost("localhost")}`;

/** The stored domain of the tenant that offers Japanese and English alone. */
const BILINGUAL_ORIGIN = `http://${tenantHost(BILINGUAL_TENANT.domain)}`;

/**
 * What a crawler reads before anything else on a tenant site: which paths it
 * may crawl, and the sitemap that lists the catalogue.
 */
test.describe("web-storefront robots.txt and sitemap", () => {
  let createdSeriesIds: string[] = [];

  test.afterEach(() => {
    deleteSeriesByPublicIds(createdSeriesIds);
    createdSeriesIds = [];
  });

  test("robots.txt keeps crawlers out of the reader-only pages and names the sitemap", async ({
    request,
  }) => {
    const response = await request.get(`${WEB_STOREFRONT_BASE_URL}/robots.txt`);

    expect(response.status()).toBe(200);
    const body = await response.text();
    const lines = body.split("\n");
    expect(lines).toContain("Allow: /");
    expect(lines).toContain("Disallow: /api/");
    expect(lines).toContain("Disallow: /my$");
    expect(lines).toContain("Disallow: /settings/");
    expect(lines).toContain("Disallow: /login?");
    expect(lines).toContain(`Sitemap: ${SEED_ORIGIN}/sitemap.xml`);
  });

  test("an episode the worker publishes joins the sitemap already served without it", async ({
    page,
    request,
  }) => {
    await signInAsSeedAdmin(page);
    const suffix = uniqueSuffix();
    const seriesId = await createSeriesViaUi(page, {
      publishedAt: publishedAtOneHourAgo(),
      synopsis: `Sitemap series ${suffix}`,
      title: `E2E Sitemap Series ${suffix}`,
    });
    createdSeriesIds.push(seriesId);
    const episodeId = await createEpisodeViaUi(page, {
      publishAt: scheduleAtFiveMinutesFromNow(),
      seriesPublicId: seriesId,
      title: `E2E Sitemap Episode ${suffix}`,
    });
    const episodeLoc = `<loc>${SEED_ORIGIN}/series/${seriesId}/episodes/${episodeId}</loc>`;

    // Fill the cached sitemap while the episode is still scheduled, so what
    // follows proves the publication drops it rather than a cold read.
    const before = await request.get(`${WEB_STOREFRONT_BASE_URL}/sitemap.xml`);
    expect(before.status()).toBe(200);
    expect(before.headers()["content-type"]).toContain("application/xml");
    expect(await before.text()).not.toContain(episodeLoc);

    nudgeScheduledEpisodeReady(episodeId);
    await waitUntilEpisodePublishedInDb(episodeId);

    // The worker's drop reaches web-storefront through the Outbox and marks the
    // entry stale, so the refilled sitemap is the one a following request reads.
    await expect(async () => {
      const after = await request.get(`${WEB_STOREFRONT_BASE_URL}/sitemap.xml`);
      expect(after.status()).toBe(200);
      const xml = await after.text();
      expect(xml).toContain(episodeLoc);
    }).toPass({ timeout: 30_000 });
  });
});

/**
 * The same two documents on a tenant that offers Japanese and English alone,
 * Japanese being its default: every URL they name is in one of those two, and
 * a prefix the tenant does not offer — which redirects — is named nowhere.
 */
test.describe("web-storefront robots.txt and sitemap on a tenant that offers two languages", () => {
  test.beforeAll(() => {
    applyScenarioSql(LOCALE_SWITCHING_SCENARIO);
  });

  test("the sitemap lists each page in the two languages alone", async ({
    request,
  }) => {
    const response = await request.get(
      `${WEB_STOREFRONT_BILINGUAL_BASE_URL}/sitemap.xml`
    );

    expect(response.status()).toBe(200);
    const xml = await response.text();
    expect(xml).toContain(`<loc>${BILINGUAL_ORIGIN}/series</loc>`);
    expect(xml).toContain(`<loc>${BILINGUAL_ORIGIN}/en/series</loc>`);
    expect(xml).toContain(
      `<xhtml:link rel="alternate" hreflang="en" href="${BILINGUAL_ORIGIN}/en/series"/>`
    );
    expect(xml).not.toContain(`${BILINGUAL_ORIGIN}/ja/`);
    expect(xml).not.toContain(`${BILINGUAL_ORIGIN}/ko`);
    expect(xml).not.toContain(`${BILINGUAL_ORIGIN}/zh-`);
    expect(xml).not.toContain('hreflang="ko"');
  });

  test("the sitemap lists a series only in the languages it is translated into", async ({
    request,
  }) => {
    const response = await request.get(
      `${WEB_STOREFRONT_BILINGUAL_BASE_URL}/sitemap.xml`
    );

    expect(response.status()).toBe(200);
    const xml = await response.text();
    const { translated, untranslated } = BILINGUAL_TENANT;
    const untranslatedPath = `/series/${untranslated.publicId}`;
    expect(xml).toContain(`<loc>${BILINGUAL_ORIGIN}${untranslatedPath}</loc>`);
    expect(xml).not.toContain(`${BILINGUAL_ORIGIN}/en${untranslatedPath}`);
    expect(xml).toContain(
      `<xhtml:link rel="alternate" hreflang="ja" href="${BILINGUAL_ORIGIN}${untranslatedPath}"/><xhtml:link rel="alternate" hreflang="x-default" href="${BILINGUAL_ORIGIN}${untranslatedPath}"/>`
    );
    expect(xml).toContain(
      `<loc>${BILINGUAL_ORIGIN}/series/${translated.publicId}</loc>`
    );
    expect(xml).toContain(
      `<loc>${BILINGUAL_ORIGIN}/en/series/${translated.publicId}</loc>`
    );
    expect(xml).toContain(
      `<loc>${BILINGUAL_ORIGIN}/en/series/${translated.publicId}/episodes/${translated.episode.publicId}</loc>`
    );
  });

  test("robots.txt names the prefixes of the two languages alone", async ({
    request,
  }) => {
    const response = await request.get(
      `${WEB_STOREFRONT_BILINGUAL_BASE_URL}/robots.txt`
    );

    expect(response.status()).toBe(200);
    const body = await response.text();
    const lines = body.split("\n");
    expect(lines).toContain("Disallow: /settings$");
    expect(lines).toContain("Disallow: /ja/settings$");
    expect(lines).toContain("Disallow: /en/settings$");
    expect(
      lines.filter((line) => /\/(?:ko|zh-Hans|zh-Hant)\//u.test(line))
    ).toStrictEqual([]);
    expect(lines).toContain(`Sitemap: ${BILINGUAL_ORIGIN}/sitemap.xml`);
  });

  test("robots.txt refuses the excluded crawler every path and the excluded path to every crawler", async ({
    request,
  }) => {
    const response = await request.get(
      `${WEB_STOREFRONT_BILINGUAL_BASE_URL}/robots.txt`
    );

    expect(response.status()).toBe(200);
    const body = await response.text();
    const lines = body.split("\n");
    const { path, userAgent } = BILINGUAL_TENANT.crawlerExclusions;
    expect(lines.slice(0, 4)).toStrictEqual([
      `User-agent: ${userAgent}`,
      "Disallow: /",
      "",
      "User-agent: *",
    ]);
    expect(lines.filter((line) => line.includes(path))).toStrictEqual(
      ["", "/ja", "/en"].flatMap((prefix) => [
        `Disallow: ${prefix}${path}$`,
        `Disallow: ${prefix}${path}/`,
        `Disallow: ${prefix}${path}?`,
      ])
    );
    expect(lines.slice(-3)).toStrictEqual([
      "",
      `Sitemap: ${BILINGUAL_ORIGIN}/sitemap.xml`,
      "",
    ]);
  });
});
