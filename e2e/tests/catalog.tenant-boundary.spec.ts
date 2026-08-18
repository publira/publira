import { expect, test } from "@playwright/test";

import { applyScenarioSql } from "../src/db";
import {
  MULTI_TENANT_SCENARIO,
  OTHER_TENANT,
  SEED_TENANT,
} from "../src/scenarios/multi-tenant";
import {
  WEB_HOST_OTHER_TENANT_BASE_URL,
  WEB_HOST_UNKNOWN_TENANT_BASE_URL,
} from "../src/urls";

const otherTenantUrl = (pathname: string): string =>
  `${WEB_HOST_OTHER_TENANT_BASE_URL}${pathname}`;

/**
 * Host-based tenant resolution and the isolation it has to guarantee: the
 * second tenant sees only its own catalog, neither tenant can reach the
 * other's records by public_id, and an unmapped Host is a 404.
 *
 * A record another tenant owns renders the not-found UI with HTTP 200, not 404:
 * the detail routes read inside `<Suspense>`, so the shell is already committed
 * when `notFound()` runs (#672). What matters for isolation is unchanged and
 * still asserted below — the other tenant's title, episode title and author
 * name never appear in the response.
 */
test.describe("web-host tenant boundary", () => {
  test.beforeAll(() => {
    applyScenarioSql(MULTI_TENANT_SCENARIO);
  });

  test("別 Host が別テナントのカタログトップを表示する", async ({ page }) => {
    const response = await page.goto(otherTenantUrl("/"));
    expect(response?.status(), await page.content()).toBe(200);

    await expect(
      page.getByRole("heading", { level: 1, name: "カタログトップ" })
    ).toBeVisible();
    await expect(
      page.getByRole("paragraph").filter({
        hasText: new RegExp(`^${OTHER_TENANT.name}$`, "u"),
      })
    ).toBeVisible();
    await expect(page.getByText(OTHER_TENANT.siteDescription)).toBeVisible();

    await expect(
      page
        .getByRole("region", { name: "注目のレーベル" })
        .getByText(OTHER_TENANT.labelName)
    ).toBeVisible();
    await expect(
      page
        .getByRole("region", { name: "注目の著者" })
        .getByText(OTHER_TENANT.authorName)
    ).toBeVisible();

    // Nothing from the dev seed tenant may leak into this render.
    await expect(page.getByText(/Seed /u)).toHaveCount(0);
  });

  test("シリーズ一覧・詳細に公開中のコンテンツだけが並ぶ", async ({ page }) => {
    await page.goto(otherTenantUrl("/series"));

    const seriesHeadings = page.getByRole("heading", { level: 2 });
    await expect(seriesHeadings).toHaveCount(1);
    await expect(seriesHeadings).toHaveText(OTHER_TENANT.publishedSeries.title);
    await expect(
      page.getByText(OTHER_TENANT.unpublishedSeries.title)
    ).toHaveCount(0);

    await page.goto(
      otherTenantUrl(`/series/${OTHER_TENANT.publishedSeries.publicId}`)
    );
    await expect(
      page.getByRole("heading", {
        level: 1,
        name: OTHER_TENANT.publishedSeries.title,
      })
    ).toBeVisible();
    await expect(
      page.getByText(OTHER_TENANT.publishedSeries.synopsis)
    ).toBeVisible();

    // Array form also pins the count, so an extra episode would fail here.
    await expect(page.locator('a[href*="/episodes/"]')).toContainText([
      ...OTHER_TENANT.publishedSeries.episodeTitles,
    ]);
    // `scheduled` listings are not published yet.
    await expect(
      page.getByText(OTHER_TENANT.publishedSeries.scheduledEpisodeTitle)
    ).toHaveCount(0);

    // Hidden from the list is not enough: the detail URL must not serve it
    // either, to anyone who guesses or leaks the episode_id.
    const scheduled = await page.goto(
      otherTenantUrl(
        `/series/${OTHER_TENANT.publishedSeries.publicId}/episodes/${OTHER_TENANT.publishedSeries.scheduledEpisodeId}`
      )
    );
    expect(scheduled?.status(), await page.content()).toBe(200);
    await expect(
      page.getByText(OTHER_TENANT.publishedSeries.scheduledEpisodeTitle)
    ).toHaveCount(0);

    const [episodeId] = OTHER_TENANT.publishedSeries.episodeIds;
    await page.goto(
      otherTenantUrl(
        `/series/${OTHER_TENANT.publishedSeries.publicId}/episodes/${episodeId}`
      )
    );
    await expect(
      page.getByRole("heading", {
        level: 1,
        name: OTHER_TENANT.publishedSeries.episodeTitles[0],
      })
    ).toBeVisible();
  });

  test("他テナントのシリーズは public_id を知っていても見えない", async ({
    page,
  }) => {
    const foreign = await page.goto(
      otherTenantUrl(`/series/${SEED_TENANT.series.publicId}`)
    );
    expect(foreign?.status(), await page.content()).toBe(200);
    await expect(page.getByText(SEED_TENANT.series.title)).toHaveCount(0);

    // …and the same in the other direction.
    const reverse = await page.goto(
      `/series/${OTHER_TENANT.publishedSeries.publicId}`
    );
    expect(reverse?.status(), await page.content()).toBe(200);
    await expect(
      page.getByText(OTHER_TENANT.publishedSeries.title)
    ).toHaveCount(0);
  });

  test("他テナントのエピソードは自テナントのシリーズ配下でも見えない", async ({
    page,
  }) => {
    // Valid own-tenant series URL, other tenant's episode_id.
    const foreign = await page.goto(
      otherTenantUrl(
        `/series/${OTHER_TENANT.publishedSeries.publicId}/episodes/${SEED_TENANT.series.freeEpisodeId}`
      )
    );
    expect(foreign?.status(), await page.content()).toBe(200);
    await expect(
      page.getByText(SEED_TENANT.series.freeEpisodeTitle)
    ).toHaveCount(0);

    // …and the same in the other direction.
    const [otherEpisodeId] = OTHER_TENANT.publishedSeries.episodeIds;
    const reverse = await page.goto(
      `/series/${SEED_TENANT.series.publicId}/episodes/${otherEpisodeId}`
    );
    expect(reverse?.status(), await page.content()).toBe(200);
    await expect(
      page.getByText(OTHER_TENANT.publishedSeries.episodeTitles[0])
    ).toHaveCount(0);
  });

  test("未公開シリーズの詳細は見つからない", async ({ page }) => {
    const response = await page.goto(
      otherTenantUrl(`/series/${OTHER_TENANT.unpublishedSeries.publicId}`)
    );

    expect(response?.status(), await page.content()).toBe(200);
    await expect(
      page.getByText(OTHER_TENANT.unpublishedSeries.title)
    ).toHaveCount(0);
  });

  test("他テナントの著者詳細は見つからない", async ({ page }) => {
    const response = await page.goto(
      otherTenantUrl(`/authors/${SEED_TENANT.authorId}`)
    );

    expect(response?.status(), await page.content()).toBe(200);
    await expect(page.getByText(SEED_TENANT.authorName)).toHaveCount(0);
  });

  test("他テナントのレーベル詳細は見つからない", async ({ page }) => {
    const response = await page.goto(
      otherTenantUrl(`/labels/${SEED_TENANT.labelId}`)
    );

    expect(response?.status(), await page.content()).toBe(200);
    await expect(
      page.getByRole("heading", { level: 1, name: "ページが見つかりません" })
    ).toBeVisible();
    await expect(page.getByText(SEED_TENANT.labelName)).toHaveCount(0);
  });

  test("検索結果に他テナントのシリーズが混ざらない", async ({ page }) => {
    const foreign = await page.goto(otherTenantUrl("/search?q=Seed"));
    expect(foreign?.status(), await page.content()).toBe(200);
    await expect(
      page.getByRole("heading", { level: 1, name: "検索" })
    ).toBeVisible();

    await expect(page.getByText(SEED_TENANT.series.title)).toHaveCount(0);

    const own = await page.goto(
      otherTenantUrl(
        `/search?q=${encodeURIComponent(OTHER_TENANT.publishedSeries.title)}`
      )
    );
    expect(own?.status(), await page.content()).toBe(200);
    await expect(
      page.getByRole("heading", { level: 1, name: "検索" })
    ).toBeVisible();
    await expect(
      page.getByRole("heading", {
        level: 2,
        name: OTHER_TENANT.publishedSeries.title,
      })
    ).toBeVisible();
  });

  test("テナントに紐づかない Host は 404", async ({ page }) => {
    const response = await page.goto(`${WEB_HOST_UNKNOWN_TENANT_BASE_URL}/`);

    // Still a real 404: `proxy.ts` answers an unmapped Host before any route
    // renders, so nothing has been committed yet.
    expect(response?.status(), await page.content()).toBe(404);
    await expect(
      page.getByRole("heading", { name: "カタログトップ" })
    ).toHaveCount(0);
  });
});
