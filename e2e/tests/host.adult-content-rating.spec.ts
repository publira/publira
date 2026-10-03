import { expect, test } from "@playwright/test";
import type { APIRequestContext } from "@playwright/test";

import { SEED_TENANT } from "../src/scenarios/multi-tenant";
import { hostPath, WEB_HOST_BASE_URL } from "../src/urls";

/** Every `<meta name="rating">` element, whatever its `content` says. */
const RATING_META = /<meta\b[^>]*\bname="rating"[^>]*>/gu;

/**
 * The `rating` meta elements in the HTML the server sends, which is what a
 * crawler classifies the page by — before any client code could add one.
 */
const ratingMetaTags = async (
  request: APIRequestContext,
  pathname: string
): Promise<string[]> => {
  const response = await request.get(
    `${WEB_HOST_BASE_URL}${hostPath(pathname)}`
  );
  expect(response.status()).toBe(200);
  const html = await response.text();
  return html.match(RATING_META) ?? [];
};

const seriesPages = (series: {
  freeEpisodeId: string;
  publicId: string;
}): string[] => [
  `/series/${series.publicId}`,
  `/series/${series.publicId}/episodes/${series.freeEpisodeId}`,
];

/**
 * A rated work's own pages are labelled adult content for SafeSearch, and no
 * other page is: a page that lists works, or an all-ages work, carrying the
 * label would pull the rest of the storefront into the same classification.
 */
test.describe("web-host adult content rating meta", () => {
  for (const [rating, series] of [
    ["R15", SEED_TENANT.r15Series],
    ["R18", SEED_TENANT.r18Series],
  ] as const) {
    test(`the series page and an episode page of an ${rating} work are labelled adult once`, async ({
      request,
    }) => {
      const tags = await Promise.all(
        seriesPages(series).map((pathname) => ratingMetaTags(request, pathname))
      );
      expect(tags).toStrictEqual([
        ['<meta name="rating" content="adult"/>'],
        ['<meta name="rating" content="adult"/>'],
      ]);
    });
  }

  test("the series page and an episode page of an all-ages work carry no rating", async ({
    request,
  }) => {
    const tags = await Promise.all(
      seriesPages(SEED_TENANT.series).map((pathname) =>
        ratingMetaTags(request, pathname)
      )
    );
    expect(tags).toStrictEqual([[], []]);
  });

  test("pages that list works carry no rating", async ({ request }) => {
    const listings = [
      "/",
      "/series",
      "/ranking",
      `/creators/${SEED_TENANT.creatorId}`,
      `/labels/${SEED_TENANT.labelId}`,
    ];
    const tags = await Promise.all(
      listings.map((pathname) => ratingMetaTags(request, pathname))
    );
    expect(tags).toStrictEqual(listings.map(() => []));
  });
});
