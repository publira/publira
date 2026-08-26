import { expect, test } from "@playwright/test";

import { SEED_TENANT } from "../src/scenarios/multi-tenant";
import { hostPath } from "../src/urls";

/** Keep in sync with `SERIES_PAGE_SIZE` in the web-host series list page. */
const SERIES_PAGE_SIZE = 24;

/**
 * Main public catalog journeys for the dev-seed tenant (Host `localhost`):
 * catalog top → series list → series detail → episode, plus the label and
 * author entry points.
 *
 * Every section streams in behind Suspense, so the assertions target the
 * resolved content rather than the skeletons.
 */
test.describe("web-host catalog browsing", () => {
  test("カタログトップの各セクションが公開データを表示する", async ({
    page,
  }) => {
    const response = await page.goto(hostPath("/"));
    expect(response?.status(), await page.content()).toBe(200);

    await expect(
      page.getByRole("heading", { level: 1, name: "カタログトップ" })
    ).toBeVisible();

    const recommended = page.getByRole("region", { name: "おすすめ作品" });
    await expect(
      recommended.locator(`a[href^="${hostPath("/series/")}"]`).first()
    ).toBeVisible();

    const newEpisodes = page.getByRole("region", { name: "新着エピソード" });
    await expect(
      newEpisodes.locator('a[href*="/episodes/"]').first()
    ).toBeVisible();

    const updatedSeries = page.getByRole("region", { name: "更新作品" });
    await expect(
      updatedSeries.locator(`a[href^="${hostPath("/series/")}"]`).first()
    ).toBeVisible();

    const featuredLabels = page.getByRole("region", { name: "注目のレーベル" });
    await expect(
      featuredLabels.getByText(/^Seed Label \d{2}$/u).first()
    ).toBeVisible();

    const featuredAuthors = page.getByRole("region", { name: "注目の著者" });
    await expect(
      featuredAuthors.locator(`a[href^="${hostPath("/authors/")}"]`).first()
    ).toBeVisible();

    // The per-section fallback must not have kicked in. Every section's
    // `SectionErrorBoundary` titles its fallback 「…を表示できませんでした」.
    await expect(page.getByText(/を表示できませんでした/u)).toHaveCount(0);
  });

  test("シリーズ一覧からシリーズ詳細とエピソードまで辿れる", async ({
    page,
  }) => {
    await page.goto(hostPath("/"));
    await page.getByRole("link", { name: "シリーズ一覧へ" }).click();

    await expect(
      page.getByRole("heading", { level: 1, name: "シリーズ一覧" })
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
    await expect(page.getByText(SEED_TENANT.authorName).first()).toBeVisible();
    await expect(
      page.getByRole("heading", { level: 2, name: "エピソード一覧" })
    ).toBeVisible();

    // Seed episodes are free except `Seed Episode 001-10` (¥500).
    await expect(page.getByText("¥500").first()).toBeVisible();

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
    await expect(
      page.getByText(`シリーズ「${SEED_TENANT.series.title}」`).first()
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "シリーズ詳細へ" })
    ).toBeVisible();
  });

  test("シリーズ一覧を cursor でページ送りできる", async ({ page }) => {
    const response = await page.goto(hostPath("/series"));
    expect(response?.status(), await page.content()).toBe(200);

    // db/seeds/dev/010_catalog.sql publishes more series than one page holds.
    // `:not([href*="/episodes/"])`: a series detail page stays mounted while
    // the next route streams in, and its episode links share the prefix.
    const seriesCards = page.locator(
      `a[href^="${hostPath("/series/")}"]:not([href*="/episodes/"])`
    );
    await expect(seriesCards).toHaveCount(SERIES_PAGE_SIZE);
    const firstPageHrefs = await seriesCards.evaluateAll((links) =>
      links.map((link) => link.getAttribute("href"))
    );

    const pagination = page.getByRole("navigation", {
      name: "シリーズ一覧ページング",
    });
    // The first page has nothing before it, so only "次のページ" is a link.
    await expect(
      pagination.getByRole("link", { name: "前のページ" })
    ).toHaveCount(0);
    await pagination.getByRole("link", { name: "次のページ" }).click();

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
    await pagination.getByRole("link", { name: "前のページ" }).click();

    // Back on the first page: nothing before it, and the same rows as before.
    await expect(
      pagination.getByRole("link", { name: "前のページ" })
    ).toHaveCount(0);
    await expect(seriesCards).toHaveCount(SERIES_PAGE_SIZE);
    await expect(
      seriesCards.evaluateAll((links) =>
        links.map((link) => link.getAttribute("href"))
      )
    ).resolves.toEqual(firstPageHrefs);
  });

  test("レーベル一覧からレーベル詳細に辿れる", async ({ page }) => {
    const response = await page.goto(hostPath("/labels"));
    expect(response?.status(), await page.content()).toBe(200);

    await expect(
      page.getByRole("heading", { level: 1, name: "レーベル一覧" })
    ).toBeVisible();
    // db/seeds/dev/010_catalog.sql creates exactly 10 labels.
    await expect(page.getByRole("heading", { level: 2 })).toHaveCount(10);

    const labelCard = page.getByRole("link").filter({
      has: page.getByRole("heading", {
        level: 2,
        name: SEED_TENANT.labelName,
      }),
    });
    await expect(labelCard).toHaveCount(1);
    await labelCard.click();

    await expect(page).toHaveURL(
      new RegExp(`/labels/${SEED_TENANT.labelId}$`, "u")
    );
    await expect(
      page.getByRole("heading", { level: 1, name: SEED_TENANT.labelName })
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { level: 2, name: "所属シリーズ" })
    ).toBeVisible();
    await expect(
      page
        .getByRole("link", { name: new RegExp(SEED_TENANT.series.title, "u") })
        .first()
    ).toBeVisible();
  });

  test("代表キーワードで期待シリーズがヒットする", async ({ page }) => {
    const response = await page.goto(hostPath("/search"));
    expect(response?.status(), await page.content()).toBe(200);

    await expect(
      page.getByRole("heading", { level: 1, name: "検索" })
    ).toBeVisible();

    const search = page.getByRole("main").getByRole("search");
    await search.getByLabel("作品を検索").fill(SEED_TENANT.series.title);
    await search.getByRole("button", { name: "検索" }).click();

    await expect(page).toHaveURL(/\/search\?q=/u);
    expect(new URL(page.url()).searchParams.get("q")).toBe(
      SEED_TENANT.series.title
    );
    await expect(
      page.getByRole("heading", {
        level: 2,
        name: SEED_TENANT.series.title,
      })
    ).toBeVisible();
  });

  test("著者一覧から著者詳細に辿れる", async ({ page }) => {
    const response = await page.goto(hostPath("/authors"));
    expect(response?.status(), await page.content()).toBe(200);

    await expect(
      page.getByRole("heading", { level: 1, name: "著者一覧" })
    ).toBeVisible();

    const authorCard = page.getByRole("link").filter({
      has: page.getByRole("heading", {
        level: 2,
        name: SEED_TENANT.authorName,
      }),
    });
    await expect(authorCard).toHaveCount(1);
    await authorCard.click();

    await expect(page).toHaveURL(
      new RegExp(`/authors/${SEED_TENANT.authorId}$`, "u")
    );
    await expect(
      page.getByRole("heading", { level: 1, name: SEED_TENANT.authorName })
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { level: 2, name: "関連シリーズ" })
    ).toBeVisible();
    await expect(
      page
        .getByRole("link", { name: new RegExp(SEED_TENANT.series.title, "u") })
        .first()
    ).toBeVisible();
  });
});
