import { expect, test } from "@playwright/test";

import { SEED_TENANT } from "../src/scenarios/multi-tenant";

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
    const response = await page.goto("/");
    expect(response?.status(), await page.content()).toBe(200);

    await expect(
      page.getByRole("heading", { level: 1, name: "カタログトップ" })
    ).toBeVisible();

    const recommended = page.getByRole("region", { name: "おすすめ作品" });
    await expect(
      recommended.locator('a[href^="/series/"]').first()
    ).toBeVisible();

    const newEpisodes = page.getByRole("region", { name: "新着エピソード" });
    await expect(
      newEpisodes.locator('a[href*="/episodes/"]').first()
    ).toBeVisible();

    const updatedSeries = page.getByRole("region", { name: "更新作品" });
    await expect(
      updatedSeries.locator('a[href^="/series/"]').first()
    ).toBeVisible();

    const featuredLabels = page.getByRole("region", { name: "注目のレーベル" });
    await expect(
      featuredLabels.getByText(/^Seed Label \d{2}$/u).first()
    ).toBeVisible();

    const featuredAuthors = page.getByRole("region", { name: "注目の著者" });
    await expect(
      featuredAuthors.locator('a[href^="/authors/"]').first()
    ).toBeVisible();

    // The per-section fallback must not have kicked in.
    await expect(page.getByText("読み込みに失敗しました")).toHaveCount(0);
  });

  test("シリーズ一覧からシリーズ詳細とエピソードまで辿れる", async ({
    page,
  }) => {
    await page.goto("/");
    await page.getByRole("link", { name: "シリーズ一覧へ" }).click();

    await expect(
      page.getByRole("heading", { level: 1, name: "シリーズ一覧" })
    ).toBeVisible();

    const seriesCard = page.getByRole("link").filter({
      has: page.getByRole("heading", {
        level: 2,
        name: SEED_TENANT.series.title,
      }),
    });
    await expect(seriesCard).toHaveCount(1);
    await seriesCard.click();

    await expect(page).toHaveURL(
      new RegExp(`/series/${SEED_TENANT.series.publicId}$`, "u")
    );
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

  test("レーベル一覧が seed レーベルを表示する", async ({ page }) => {
    const response = await page.goto("/labels");
    expect(response?.status(), await page.content()).toBe(200);

    await expect(
      page.getByRole("heading", { level: 1, name: "レーベル一覧" })
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { level: 2, name: "Seed Label 01" })
    ).toBeVisible();
    // db/seeds/dev/010_catalog.sql creates exactly 10 labels.
    await expect(page.getByRole("heading", { level: 2 })).toHaveCount(10);
  });

  test("著者一覧から著者詳細に辿れる", async ({ page }) => {
    const response = await page.goto("/authors");
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
