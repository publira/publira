import { expect, test } from "@playwright/test";

import {
  createEpisodeViaUi,
  createSeriesViaUi,
  signInAsSeedAdmin,
} from "../src/admin";
import { deleteSeriesByPublicIds } from "../src/db";
import {
  nudgeScheduledEpisodeReady,
  waitUntilEpisodePublishedInDb,
} from "../src/publish";
import {
  publishedAtOneHourAgo,
  scheduleAtFiveMinutesFromNow,
  uniqueSuffix,
} from "../src/scenarios/admin-publish";
import { tenantHost, WEB_HOST_BASE_URL } from "../src/urls";

/** The development seed tenant's stored domain, which it publishes under. */
const SEED_ORIGIN = `http://${tenantHost("localhost")}`;

/**
 * What a crawler reads before anything else on a tenant site: which paths it
 * may crawl, and the sitemap that lists the catalogue.
 */
test.describe("web-host robots.txt and sitemap", () => {
  let createdSeriesIds: string[] = [];

  test.afterEach(() => {
    deleteSeriesByPublicIds(createdSeriesIds);
    createdSeriesIds = [];
  });

  test("robots.txt keeps crawlers out of the reader-only pages and names the sitemap", async ({
    request,
  }) => {
    const response = await request.get(`${WEB_HOST_BASE_URL}/robots.txt`);

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
    const before = await request.get(`${WEB_HOST_BASE_URL}/sitemap.xml`);
    expect(before.status()).toBe(200);
    expect(before.headers()["content-type"]).toContain("application/xml");
    expect(await before.text()).not.toContain(episodeLoc);

    nudgeScheduledEpisodeReady(episodeId);
    await waitUntilEpisodePublishedInDb(episodeId);

    // The worker's drop reaches web-host through the Outbox and marks the
    // entry stale, so the refilled sitemap is the one a following request reads.
    await expect(async () => {
      const after = await request.get(`${WEB_HOST_BASE_URL}/sitemap.xml`);
      expect(after.status()).toBe(200);
      const xml = await after.text();
      expect(xml).toContain(episodeLoc);
      // The same episode in another locale is an entry of its own.
      expect(xml).toContain(
        `<loc>${SEED_ORIGIN}/ja/series/${seriesId}/episodes/${episodeId}</loc>`
      );
    }).toPass({ timeout: 30_000 });
  });
});
