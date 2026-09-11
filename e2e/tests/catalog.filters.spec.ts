import { expect, test } from "@playwright/test";

import { hostPath } from "../src/urls";

/**
 * The series `db/seeds/dev/010_catalog.sql` pauses: every tenth-but-five of
 * the hundred it publishes, in title order, so `Seed Series 005` through
 * `Seed Series 095`.
 *
 * Hiatus rather than completed, which the admin publish-flow suite also writes
 * on a series of its own: nothing else in this suite pauses one, so this set is
 * exactly what the filter has to answer with however often the run repeats.
 * `public_id` is `Seed` + `SERS` + the four-digit number with `0` written as
 * `A` (`db/seeds/dev/010_catalog.sql`).
 */
const HIATUS_SERIES_PATHS = [
  "SeedSERSAAA5",
  "SeedSERSAA15",
  "SeedSERSAA25",
  "SeedSERSAA35",
  "SeedSERSAA45",
  "SeedSERSAA55",
  "SeedSERSAA65",
  "SeedSERSAA75",
  "SeedSERSAA85",
  "SeedSERSAA95",
].map((publicId) => hostPath(`/series/${publicId}`));

/**
 * The first genre of `db/seeds/dev/010_catalog.sql`, which deals one genre per
 * series round-robin in title order: `Seed Series 001` carries Fantasy and
 * `Seed Series 002` carries Romance.
 */
const SEED_GENRE = {
  name: "Fantasy",
  publicId: "SeedGENRAAA1",
  seriesPublicId: "SeedSERSAAA1",
} as const;

/** Carries the next genre round, so a Fantasy page must not show it. */
const OTHER_GENRE_SERIES_PUBLIC_ID = "SeedSERSAAA2";

/**
 * The fourth tag of `db/seeds/dev/010_catalog.sql` in slug order, which deals
 * one tag per series the same way: `Seed Series 004` carries it and
 * `Seed Series 001` carries the first tag instead.
 *
 * A tag is addressed by its slug rather than a public ID, and the name beside
 * it on the page is what says the slug was resolved back to a tag.
 */
const SEED_TAG = {
  name: "Time travel",
  seriesPublicId: "SeedSERSAAA4",
  slug: "time-travel",
} as const;

/** Carries the first tag round, so a Time travel page must not show it. */
const OTHER_TAG_SERIES_PUBLIC_ID = "SeedSERSAAA1";

/**
 * The covers of a series list. `:not([href*="/episodes/"])`: the route the
 * reader came from stays mounted while the next one streams in, and its
 * episode links share the prefix.
 */
const seriesCards = (path = "/series/") =>
  `a[href^="${hostPath(path)}"]:not([href*="/episodes/"])`;

/**
 * Narrowing and ordering the public catalogue, which the storefront keeps in
 * the query string so every state of a list is a URL a reader can share.
 */
test.describe("web-host catalog filters", () => {
  test("the series list narrows to one serialization status and sorts by title", async ({
    page,
  }) => {
    const response = await page.goto(hostPath("/series"));
    expect(response?.status(), await page.content()).toBe(200);

    const cards = page.locator(seriesCards());
    // The unnarrowed list fills a page, which is what the filter narrows.
    await expect(cards).toHaveCount(24);

    await page.getByLabel("Status").selectOption("hiatus");
    await page.getByLabel("Sort").selectOption("title");
    await page.getByRole("button", { name: "Apply" }).click();

    await expect(page).toHaveURL(/[?&]order=title/u);
    await expect(page).toHaveURL(/[?&]status=hiatus/u);

    // Exactly the paused series, in title order: the filter and the sort are
    // the server's, and both are read back off the page rather than trusted.
    await expect(cards).toHaveCount(HIATUS_SERIES_PATHS.length);
    await expect(
      cards.evaluateAll((links) =>
        links.map((link) => link.getAttribute("href"))
      )
    ).resolves.toEqual(HIATUS_SERIES_PATHS);

    // Reset drops the query rather than resubmitting the fields, so the reader
    // lands back on the whole catalogue.
    await page.getByRole("link", { name: "Reset" }).click();
    await expect(page).toHaveURL(hostPath("/series"));
    await expect(cards).toHaveCount(24);
  });

  test("a genre chip leads to that genre's series", async ({ page }) => {
    const response = await page.goto(hostPath("/genres"));
    expect(response?.status(), await page.content()).toBe(200);

    await expect(
      page.getByRole("heading", { level: 1, name: "Genres" })
    ).toBeVisible();

    await page
      .getByRole("link", { exact: false, name: SEED_GENRE.name })
      .first()
      .click();

    await expect(page).toHaveURL(hostPath(`/genres/${SEED_GENRE.publicId}`));
    await expect(
      page.getByRole("heading", { level: 1, name: SEED_GENRE.name })
    ).toBeVisible();

    // The genre is the page rather than a field, so what it shows is the
    // assertion: a series that carries it, and not the one that carries the
    // next genre in the seed's round-robin.
    const carried = hostPath(`/series/${SEED_GENRE.seriesPublicId}`);
    const notCarried = hostPath(`/series/${OTHER_GENRE_SERIES_PUBLIC_ID}`);
    await expect(page.locator(`a[href="${carried}"]`)).toBeVisible();
    await expect(page.locator(`a[href="${notCarried}"]`)).toHaveCount(0);
  });

  test("a tag slug names the series that carry it", async ({ page }) => {
    // Title order rather than the newest: the seed deals this tag to more
    // series than one page holds, and the one this asserts on is only in a
    // known place when the sort is.
    const response = await page.goto(
      hostPath(`/tags/${SEED_TAG.slug}?order=title`)
    );
    expect(response?.status(), await page.content()).toBe(200);

    // The heading is the tag's name rather than the slug in the URL, which is
    // what says the slug was resolved back to a tag.
    await expect(
      page.getByRole("heading", { level: 1, name: SEED_TAG.name })
    ).toBeVisible();

    const carried = hostPath(`/series/${SEED_TAG.seriesPublicId}`);
    const notCarried = hostPath(`/series/${OTHER_TAG_SERIES_PUBLIC_ID}`);
    await expect(page.locator(`a[href="${carried}"]`)).toBeVisible();
    await expect(page.locator(`a[href="${notCarried}"]`)).toHaveCount(0);
  });

  test("the home page opens the genres it lists", async ({ page }) => {
    await page.goto(hostPath("/"));

    const genres = page.getByRole("region", { name: "Browse by genre" });
    await expect(
      genres.getByRole("link", { name: SEED_GENRE.name })
    ).toBeVisible();

    await genres.getByRole("link", { name: "View all" }).click();
    await expect(page).toHaveURL(hostPath("/genres"));
  });
});
