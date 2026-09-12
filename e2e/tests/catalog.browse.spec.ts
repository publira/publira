import { expect, test } from "@playwright/test";

import { SEED_TENANT } from "../src/scenarios/multi-tenant";
import { hostPath, localeHostPath } from "../src/urls";

/** Keep in sync with `SERIES_PAGE_SIZE` in the web-host series list page. */
const SERIES_PAGE_SIZE = 24;

/** Labels created by `db/seeds/dev/010_catalog.sql`. */
const SEED_LABEL_COUNT = 10;

/** Keep in sync with `RELATED_SERIES_COUNT` in the web-host series detail page. */
const RELATED_SERIES_COUNT = 6;

/**
 * Main public catalog journeys for the dev-seed tenant (Host `localhost`):
 * catalog top → series list → series detail → episode, plus the label and
 * creator entry points.
 *
 * Every section streams in behind Suspense, so the assertions target the
 * resolved content rather than the skeletons.
 */
test.describe("web-host catalog browsing", () => {
  test("every catalog top section shows published data", async ({ page }) => {
    const response = await page.goto(hostPath("/"));
    expect(response?.status(), await page.content()).toBe(200);

    // The featured work is the page's own heading, and its reading button is
    // the single Shu element the design allows on this screen.
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(
      page.getByRole("link", { name: /^Read episode \d+$/u })
    ).toBeVisible();

    // The popularity module. The seed tenant carries a ranking snapshot
    // (`170_ranking.sql`), so it is the week's chart rather than the
    // recommendation shelf a tenant sees before the batch has run.
    const ranking = page.getByRole("region", { name: "Top 10 this week" });
    await expect(
      ranking.locator(`a[href^="${hostPath("/series/")}"]`).first()
    ).toBeVisible();

    const newEpisodes = page.getByRole("region", { name: "New episodes" });
    await expect(
      newEpisodes.locator('a[href*="/episodes/"]').first()
    ).toBeVisible();

    // Every cover on this shelf carries how many episodes of it are free, and
    // that is what the module is for: the badge is the assertion.
    const freeSeries = page.getByRole("region", { name: "Free to read" });
    await expect(
      freeSeries.locator(`a[href^="${hostPath("/series/")}"]`).first()
    ).toBeVisible();
    await expect(
      freeSeries.getByText(/^\d+ free episodes$/u).first()
    ).toBeVisible();

    const updatedSeries = page.getByRole("region", {
      name: "Recently updated",
    });
    await expect(
      updatedSeries.locator(`a[href^="${hostPath("/series/")}"]`).first()
    ).toBeVisible();

    const featuredLabels = page.getByRole("region", {
      name: "Featured labels",
    });
    await expect(
      featuredLabels.getByText(/^Seed Label \d{2}$/u).first()
    ).toBeVisible();

    const featuredCreators = page.getByRole("region", {
      name: "Featured authors",
    });
    await expect(
      featuredCreators.locator(`a[href^="${hostPath("/creators/")}"]`).first()
    ).toBeVisible();

    // The per-section fallback must not have kicked in. Every section's
    // `SectionErrorBoundary` titles its fallback "Could not show the …".
    await expect(page.getByText(/Could not show the/u)).toHaveCount(0);
  });

  test("the series list leads through series detail to an episode", async ({
    page,
  }) => {
    await page.goto(hostPath("/"));
    // "Recently updated" rather than the popularity module above it: that one
    // leads to `/ranking` while the seed tenant carries a snapshot.
    await page
      .getByRole("region", { name: "Recently updated" })
      .getByRole("link", { name: "View all" })
      .click();

    await expect(
      page.getByRole("heading", { level: 1, name: "Series" })
    ).toBeVisible();
    // Seed published_at is a hash-based offset around "today", so a fixed
    // series is not guaranteed to sit on page 1 of published_at-desc order.
    // Assert the list itself is populated; the known seed series is opened by
    // public_id below.
    await expect(
      page.locator(`a[href^="${hostPath("/series/")}"]`).first()
    ).toBeVisible();

    await page.goto(hostPath(`/series/${SEED_TENANT.series.publicId}`));
    await expect(
      page.getByRole("heading", { level: 1, name: SEED_TENANT.series.title })
    ).toBeVisible();
    // `.first()`: the previous route can still be mounted while the client-side
    // navigation streams in, so the name may match more than one node.
    await expect(page.getByText(SEED_TENANT.creatorName).first()).toBeVisible();
    await expect(
      page.getByRole("heading", { level: 2, name: "Episodes" })
    ).toBeVisible();

    // Seed episodes are free except `Seed Episode 001-10` (¥500).
    await expect(page.getByText("¥500").first()).toBeVisible();

    // The strip of what to read next. The server ranks the unrelated in behind
    // the related rather than cutting the list off, so a seeded catalogue
    // always fills it.
    const relatedHeading = page.getByRole("heading", {
      level: 2,
      name: "You may also like",
    });
    await expect(relatedHeading).toBeVisible();
    await expect(
      page.locator("section").filter({ has: relatedHeading }).getByRole("link")
    ).toHaveCount(RELATED_SERIES_COUNT);

    const episodeLink = page.getByRole("link", {
      name: new RegExp(SEED_TENANT.series.freeEpisodeTitle, "u"),
    });
    await expect(episodeLink).toHaveCount(1);
    await episodeLink.click();

    await expect(page).toHaveURL(
      new RegExp(`/episodes/${SEED_TENANT.series.freeEpisodeId}$`, "u")
    );
    await expect(
      page.getByRole("heading", {
        level: 1,
        name: SEED_TENANT.series.freeEpisodeTitle,
      })
    ).toBeVisible();
    // The running head names the work above the episode's own title, and it
    // is the way back to it.
    await expect(
      page
        .getByRole("link", { exact: true, name: SEED_TENANT.series.title })
        .first()
    ).toHaveAttribute(
      "href",
      hostPath(`/series/${SEED_TENANT.series.publicId}`)
    );
  });

  test("the series list pages through with a cursor", async ({ page }) => {
    const response = await page.goto(hostPath("/series"));
    expect(response?.status(), await page.content()).toBe(200);

    // db/seeds/dev/010_catalog.sql publishes more series than one page holds.
    // A series detail page this test opens stays in the document behind the
    // list it returns to — Next.js keeps the tree it navigated away from — and
    // it carries links of both shapes: its episode rows, and the covers of
    // "You may also like". `:not([href*="/episodes/"])` drops the first, and
    // `:visible` drops what the reader is no longer looking at.
    const seriesCards = page.locator(
      `a[href^="${hostPath("/series/")}"]:not([href*="/episodes/"]):visible`
    );
    await expect(seriesCards).toHaveCount(SERIES_PAGE_SIZE);
    const firstPageHrefs = await seriesCards.evaluateAll((links) =>
      links.map((link) => link.getAttribute("href"))
    );

    const pagination = page.getByRole("navigation", {
      name: "Series list pagination",
    });
    // The first page has nothing before it, so only "Next page" is a link.
    await expect(
      pagination.getByRole("link", { name: "Previous page" })
    ).toHaveCount(0);
    await pagination.getByRole("link", { name: "Next page" }).click();

    await expect(page).toHaveURL(/\/series\?token=/u);
    await expect(seriesCards).toHaveCount(SERIES_PAGE_SIZE);
    const secondPageHrefs = await seriesCards.evaluateAll((links) =>
      links.map((link) => link.getAttribute("href"))
    );
    // Keyset paging must not repeat a row across the page boundary.
    expect(
      secondPageHrefs.filter((href) => firstPageHrefs.includes(href))
    ).toEqual([]);

    // Every page keeps the detail entry point.
    const [secondPageHref] = secondPageHrefs;
    await seriesCards.first().click();
    await expect(page).toHaveURL(new RegExp(`${secondPageHref}$`, "u"));
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

    await page.goBack();
    await pagination.getByRole("link", { name: "Previous page" }).click();

    // Back on the first page: nothing before it, and the same rows as before.
    await expect(
      pagination.getByRole("link", { name: "Previous page" })
    ).toHaveCount(0);
    await expect(seriesCards).toHaveCount(SERIES_PAGE_SIZE);
    await expect(
      seriesCards.evaluateAll((links) =>
        links.map((link) => link.getAttribute("href"))
      )
    ).resolves.toEqual(firstPageHrefs);
  });

  test("the label list leads to label detail", async ({ page }) => {
    const response = await page.goto(hostPath("/labels"));
    expect(response?.status(), await page.content()).toBe(200);

    await expect(
      page.getByRole("heading", { level: 1, name: "Labels" })
    ).toBeVisible();
    // One row per label, each a single link. Counting the seeded names rather
    // than every row: the admin suites run beside this one and register labels
    // of their own — all named `E2E …` — which sort onto this first page until
    // their test deletes them again, so a count of the whole page is a race.
    await expect(
      page.getByRole("link", { name: /^Seed Label \d{2}$/u })
    ).toHaveCount(SEED_LABEL_COUNT);

    const labelRow = page.getByRole("link", {
      exact: true,
      name: SEED_TENANT.labelName,
    });
    await expect(labelRow).toHaveCount(1);
    await labelRow.click();

    await expect(page).toHaveURL(
      new RegExp(`/labels/${SEED_TENANT.labelId}$`, "u")
    );
    await expect(
      page.getByRole("heading", { level: 1, name: SEED_TENANT.labelName })
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { level: 2, name: "Series in this label" })
    ).toBeVisible();
    await expect(
      page
        .getByRole("link", { name: new RegExp(SEED_TENANT.series.title, "u") })
        .first()
    ).toBeVisible();
  });

  test("a representative keyword hits the expected series", async ({
    page,
  }) => {
    const response = await page.goto(hostPath("/search"));
    expect(response?.status(), await page.content()).toBe(200);

    await expect(
      page.getByRole("heading", { level: 1, name: "Search" })
    ).toBeVisible();

    const search = page.getByRole("main").getByRole("search");
    await search.getByLabel("Search works").fill(SEED_TENANT.series.title);
    await search.getByRole("button", { name: "Search" }).click();

    await expect(page).toHaveURL(/\/search\?q=/u);
    expect(new URL(page.url()).searchParams.get("q")).toBe(
      SEED_TENANT.series.title
    );
    // Each result is one row, and one link, inside the group it belongs to.
    await expect(
      page
        .getByRole("region", { exact: true, name: "Series" })
        .getByRole("link", {
          name: new RegExp(`^${SEED_TENANT.series.title}\\b`, "u"),
        })
        .first()
    ).toBeVisible();
  });

  test("a creator's name finds the creator when no series matches", async ({
    page,
  }) => {
    const response = await page.goto(
      hostPath(`/search?q=${encodeURIComponent(SEED_TENANT.creatorName)}`)
    );
    expect(response?.status(), await page.content()).toBe(200);

    // The seeded synopses name their own series and never a creator, so this
    // keyword reaches the creator group alone: the whole point of searching
    // more than series titles.
    await expect(
      page.getByRole("region", { exact: true, name: "Series" })
    ).toContainText(`No series match “${SEED_TENANT.creatorName}”.`);

    const creatorRow = page
      .getByRole("region", { exact: true, name: "Authors" })
      .getByRole("link", {
        name: new RegExp(`^${SEED_TENANT.creatorName}\\b`, "u"),
      });
    await expect(creatorRow).toHaveCount(1);
    await creatorRow.click();

    await expect(page).toHaveURL(
      new RegExp(`/creators/${SEED_TENANT.creatorId}$`, "u")
    );
  });

  test("a group with more matches than the overview shows opens on its own", async ({
    page,
  }) => {
    // Every seeded creator is named `Seed Author NNN`, so the prefix alone
    // matches far more of them than the overview lists.
    const response = await page.goto(hostPath("/search?q=Seed+Author"));
    expect(response?.status(), await page.content()).toBe(200);

    const creators = page.getByRole("region", { exact: true, name: "Authors" });
    await creators.getByRole("link", { name: "Show all authors" }).click();

    await expect(page).toHaveURL(/\/search\?q=Seed\+Author&kind=creators$/u);
    // The group is alone on the screen now, and it pages.
    await expect(
      page.getByRole("region", { exact: true, name: "Series" })
    ).toHaveCount(0);
    await expect(
      page.getByRole("navigation", { name: "Author result pagination" })
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: /^Seed Author \d{3}\b/u })
    ).not.toHaveCount(0);
  });

  test("the creator list leads to creator detail", async ({ page }) => {
    const response = await page.goto(hostPath("/creators"));
    expect(response?.status(), await page.content()).toBe(200);

    await expect(
      page.getByRole("heading", { level: 1, name: "Authors" })
    ).toBeVisible();

    // Each row is one link carrying the name and the series count beside it.
    const creatorRow = page.getByRole("link", {
      name: new RegExp(`^${SEED_TENANT.creatorName}\\b`, "u"),
    });
    await expect(creatorRow).toHaveCount(1);
    await creatorRow.click();

    await expect(page).toHaveURL(
      new RegExp(`/creators/${SEED_TENANT.creatorId}$`, "u")
    );
    await expect(
      page.getByRole("heading", { level: 1, name: SEED_TENANT.creatorName })
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { level: 2, name: "Related series" })
    ).toBeVisible();
    await expect(
      page
        .getByRole("link", { name: new RegExp(SEED_TENANT.series.title, "u") })
        .first()
    ).toBeVisible();
  });

  // These pages were served under `/authors` until they moved, so a bookmark or
  // an inbound link from before the move is answered permanently — carrying the
  // locale prefix, the id, and the query it was made with.
  test("a link to the retired /authors path reaches /creators", async ({
    page,
  }) => {
    const list = await page.request.get(hostPath("/authors"), {
      maxRedirects: 0,
    });
    expect(list.status()).toBe(308);
    expect(new URL(list.headers().location ?? "", list.url()).pathname).toBe(
      "/creators"
    );

    const detail = await page.request.get(
      hostPath(`/authors/${SEED_TENANT.creatorId}?token=djF8Zg`),
      { maxRedirects: 0 }
    );
    expect(detail.status()).toBe(308);
    const detailLocation = new URL(
      detail.headers().location ?? "",
      detail.url()
    );
    expect(detailLocation.pathname).toBe(`/creators/${SEED_TENANT.creatorId}`);
    expect(detailLocation.search).toBe("?token=djF8Zg");

    const prefixed = await page.request.get(
      localeHostPath("ja", `/authors/${SEED_TENANT.creatorId}`),
      { maxRedirects: 0 }
    );
    expect(prefixed.status()).toBe(308);
    expect(
      new URL(prefixed.headers().location ?? "", prefixed.url()).pathname
    ).toBe(`/ja/creators/${SEED_TENANT.creatorId}`);

    // Following it renders the creator the old URL named.
    await page.goto(hostPath(`/authors/${SEED_TENANT.creatorId}`));
    await expect(page).toHaveURL(
      new RegExp(`/creators/${SEED_TENANT.creatorId}$`, "u")
    );
    await expect(
      page.getByRole("heading", { level: 1, name: SEED_TENANT.creatorName })
    ).toBeVisible();
  });
});
