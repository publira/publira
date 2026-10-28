import { expect, test } from "@playwright/test";
import type { APIRequestContext, Page } from "@playwright/test";

import { SEED_TENANT } from "../src/scenarios/multi-tenant";
import { localeStorefrontPath, storefrontPath, tenantHost } from "../src/urls";

/** The development seed tenant's stored domain, over the edge's plain HTTP. */
const SEED_ORIGIN = `http://${tenantHost("localhost")}`;

/** Seeded by `db/seeds/dev/010_catalog.sql`, like the ones in `catalog.filters.spec.ts`. */
const SEED_GENRE_PUBLIC_ID = "SeedGENRAAA1";
const SEED_TAG_SLUG = "time-travel";

const SERIES_PATH = `/series/${SEED_TENANT.series.publicId}`;

/** The `og:image` a page declares, once metadata has streamed in. */
const openGraphImage = async (page: Page): Promise<string> => {
  const image = page.locator('meta[property="og:image"]');
  await expect(image).toHaveCount(1);
  const url = (await image.getAttribute("content")) ?? "";
  await expect(page.locator('meta[name="twitter:image"]')).toHaveAttribute(
    "content",
    url
  );
  return url;
};

const expectImage = async (
  request: APIRequestContext,
  url: string
): Promise<void> => {
  const response = await request.get(url);
  expect(response.status(), url).toBe(200);
  expect(response.headers()["content-type"], url).toMatch(/^image\//u);
  const body = await response.body();
  expect(body.byteLength, url).toBeGreaterThan(0);
};

/**
 * Every kind of public page unfurls with a picture: its own uploaded eye-catch
 * where it has one, and otherwise the card the storefront draws for it, at an
 * address on the tenant's domain that answers with an image.
 */
test.describe("web-storefront Open Graph cards", () => {
  const drawnCards = [
    ["the top page", "/", "/og"],
    ["a page with no card of its own", "/ranking", "/og"],
    [
      "a label",
      `/labels/${SEED_TENANT.labelId}`,
      `/og/labels/${SEED_TENANT.labelId}`,
    ],
    [
      "a creator",
      `/creators/${SEED_TENANT.creatorId}`,
      `/og/creators/${SEED_TENANT.creatorId}`,
    ],
    [
      "a genre",
      `/genres/${SEED_GENRE_PUBLIC_ID}`,
      `/og/genres/${SEED_GENRE_PUBLIC_ID}`,
    ],
    ["a tag", `/tags/${SEED_TAG_SLUG}`, `/og/tags/${SEED_TAG_SLUG}`],
    ["a published page", "/privacy", "/og/page/privacy"],
  ] as const;

  for (const [name, path, cardPath] of drawnCards) {
    test(`${name} unfurls into the card drawn for it`, async ({
      page,
      request,
    }) => {
      await page.goto(storefrontPath(path));

      const url = await openGraphImage(page);
      expect(url).toBe(`${SEED_ORIGIN}${cardPath}`);
      await expectImage(request, url);
    });
  }

  test("a card under another locale carries that locale's prefix", async ({
    page,
    request,
  }) => {
    await page.goto(
      localeStorefrontPath("ja", `/labels/${SEED_TENANT.labelId}`)
    );

    const url = await openGraphImage(page);
    expect(url).toBe(`${SEED_ORIGIN}/ja/og/labels/${SEED_TENANT.labelId}`);
    await expectImage(request, url);
  });

  test("a series with an uploaded eye-catch keeps it", async ({
    page,
    request,
  }) => {
    await page.goto(storefrontPath(SERIES_PATH));

    const url = await openGraphImage(page);
    expect(new URL(url).pathname).toMatch(/^\/images\/series\/[^/]+\/og\//u);
    await expectImage(request, url);
  });

  test("an episode unfurls with a picture", async ({ page, request }) => {
    await page.goto(
      storefrontPath(
        `${SERIES_PATH}/episodes/${SEED_TENANT.series.freeEpisodeId}`
      )
    );

    await expectImage(request, await openGraphImage(page));
  });

  test("the series and episode cards are drawn for a work without artwork", async ({
    request,
  }) => {
    await expectImage(
      request,
      `${SEED_ORIGIN}/og/series/${SEED_TENANT.series.publicId}`
    );
    await expectImage(
      request,
      `${SEED_ORIGIN}/og/series/${SEED_TENANT.series.publicId}/episodes/${SEED_TENANT.series.freeEpisodeId}`
    );
  });

  test("a card for a subject the site does not have answers 404", async ({
    request,
  }) => {
    const response = await request.get(`${SEED_ORIGIN}/og/series/ZZZZZZZZZZZZ`);

    expect(response.status()).toBe(404);
  });
});
