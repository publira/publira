import { expect, test } from "@playwright/test";

import {
  createEpisodeViaUi,
  createSeriesViaUi,
  formMessage,
  signInAsSeedAdmin,
} from "../src/admin";
import { applyScenarioSql, querySql, runSql } from "../src/db";
import {
  publishedAtOneHourAgo,
  scheduleAtNinetySecondsFromNow,
  uniqueSuffix,
} from "../src/scenarios/admin-publish";
import {
  MULTI_TENANT_SCENARIO,
  OTHER_TENANT,
} from "../src/scenarios/multi-tenant";
import { WEB_ADMIN_BASE_URL, WEB_HOST_BASE_URL } from "../src/urls";

const hostUrl = (pathname: string): string => `${WEB_HOST_BASE_URL}${pathname}`;

const adminUrl = (pathname: string): string =>
  `${WEB_ADMIN_BASE_URL}${pathname}`;

/**
 * Advance a scheduled episode so the publish-episodes worker can pick it up
 * without waiting for the minute-granularity `datetime-local` value.
 * The listing stays `scheduled`; only `scheduled_at` moves into the past.
 */
const nudgeScheduledEpisodeReady = (episodePublicId: string): void => {
  // public_id is Base58 from the server — safe for a single-quoted literal.
  runSql(`
    UPDATE episode_listings el
    SET scheduled_at = NOW() - INTERVAL '5 seconds'
    FROM episodes e
    WHERE e.id = el.episode_id
      AND e.public_id = '${episodePublicId}'
      AND el.status = 'scheduled';
  `);
};

/**
 * Wait until the publish-episodes worker has promoted the listing.
 * Poll via SQL (not web-host): a premature host request would cache the 404
 * under `"use cache"` and keep failing after the worker succeeds.
 */
const waitUntilEpisodePublishedInDb = async (
  episodePublicId: string
): Promise<void> => {
  await expect
    .poll(
      () =>
        querySql(`
          SELECT el.status
          FROM episodes e
          JOIN episode_listings el ON el.episode_id = e.id
          WHERE e.public_id = '${episodePublicId}'
          LIMIT 1
        `),
      {
        message: `episode ${episodePublicId} was not published by the worker`,
        timeout: 30_000,
      }
    )
    .toBe("published");
};

/**
 * Admin → admin API → public API → web-host publish flow (#516).
 *
 * Login is a prerequisite helper (full auth coverage is #67). Each test uses a
 * unique title so runs do not depend on leftover rows from a previous suite.
 */
test.describe("admin publish flow", () => {
  test.beforeEach(async ({ page }) => {
    await signInAsSeedAdmin(page);
  });

  test("シリーズを下書き作成し、編集後に管理画面へ再表示される", async ({
    page,
  }) => {
    const suffix = uniqueSuffix();
    const title = `E2E Draft Series ${suffix}`;
    const synopsis = `下書き概要 ${suffix}`;

    const seriesId = await createSeriesViaUi(page, { synopsis, title });

    await expect(page).toHaveURL(new RegExp(`/series/${seriesId}`, "u"));
    await expect(page.locator("#series_title")).toHaveValue(title);
    await expect(page.locator("#series_synopsis")).toHaveValue(synopsis);
    // Draft: published_at left empty.
    await expect(page.locator("#series_published_at")).toHaveValue("");

    const editedTitle = `${title} (edited)`;
    const editedSynopsis = `${synopsis} (edited)`;
    await page.locator("#series_title").fill(editedTitle);
    await page.locator("#series_synopsis").fill(editedSynopsis);
    await page.getByRole("button", { name: "シリーズを更新" }).click();
    // FlashToast strips `?updated=1` via client replace; assert on values
    // rather than waiting for a load event that may never re-fire.
    await expect(page.locator("#series_title")).toHaveValue(editedTitle, {
      timeout: 30_000,
    });
    await expect(page.locator("#series_synopsis")).toHaveValue(editedSynopsis);

    // List row reflects the save.
    await page.goto(adminUrl("/series"));
    await expect(page.getByText(editedTitle)).toBeVisible();
    // Exact match: the synopsis cell can also contain the word 下書き.
    await expect(
      page
        .locator("tr", { hasText: editedTitle })
        .getByText("下書き", { exact: true })
    ).toBeVisible();
  });

  test("シリーズを公開すると同じ tenant の web-host で確認できる", async ({
    page,
  }) => {
    const suffix = uniqueSuffix();
    const title = `E2E Published Series ${suffix}`;
    const synopsis = `公開概要 ${suffix}`;
    // Past wall clock → immediate publish on create.
    const seriesId = await createSeriesViaUi(page, {
      publishedAt: publishedAtOneHourAgo(),
      synopsis,
      title,
    });

    // After create the edit form may briefly coexist with a streaming shell —
    // pin the filled title field, not every #series_title in the tree.
    await expect(page.getByRole("textbox", { name: /タイトル/u })).toHaveValue(
      title
    );
    await expect(page.locator("#series_published_at").first()).not.toHaveValue(
      ""
    );

    // Brand-new public_id: first host request misses cache and hits public API.
    const response = await page.goto(hostUrl(`/series/${seriesId}`));
    expect(response?.status(), await page.content()).toBe(200);
    await expect(
      page.getByRole("heading", { level: 1, name: title })
    ).toBeVisible();
    await expect(page.getByText(synopsis)).toBeVisible();
  });

  test("エピソードを入稿・予約し、公開後に web-host へ反映される", async ({
    page,
  }) => {
    const suffix = uniqueSuffix();
    const seriesTitle = `E2E Episode Parent ${suffix}`;
    const episodeTitle = `E2E Episode ${suffix}`;

    const seriesId = await createSeriesViaUi(page, {
      publishedAt: publishedAtOneHourAgo(),
      synopsis: `親シリーズ ${suffix}`,
      title: seriesTitle,
    });

    // Schedule ~90s ahead (datetime-local minute precision). The worker
    // cannot fire yet; we nudge scheduled_at into the past after create so the
    // suite stays under a few seconds rather than waiting a full minute.
    const episodeId = await createEpisodeViaUi(page, {
      publishAt: scheduleAtNinetySecondsFromNow(),
      seriesPublicId: seriesId,
      title: episodeTitle,
    });

    // Admin list shows the scheduled listing before the worker runs.
    await page.goto(adminUrl(`/series/${seriesId}/episodes`));
    await expect(page.getByText(episodeTitle)).toBeVisible();
    await expect(page.getByText(/status: scheduled/u)).toBeVisible();

    // Do not fetch the host URL while the episode is still scheduled: web-host
    // would cache the 404 under `"use cache"` and keep missing after publish.
    nudgeScheduledEpisodeReady(episodeId);
    await waitUntilEpisodePublishedInDb(episodeId);

    // First host request after DB publish — never seen this public_id before.
    const episodeResponse = await page.goto(
      hostUrl(`/series/${seriesId}/episodes/${episodeId}`)
    );
    expect(episodeResponse?.status(), await page.content()).toBe(200);
    await expect(
      page.getByRole("heading", { level: 1, name: episodeTitle })
    ).toBeVisible();

    // Parent series detail also lists the published episode.
    await page.goto(hostUrl(`/series/${seriesId}`));
    await expect(page.getByText(episodeTitle)).toBeVisible();
  });

  test("必須項目が欠けているとエラーが表示される", async ({ page }) => {
    await page.goto(adminUrl("/series/new"));
    await page.locator("#series_title").fill(`E2E Invalid ${uniqueSuffix()}`);
    await page.locator("#series_synopsis").fill("概要だけ埋めた不完全な入力");
    // Intentionally skip label selection.
    await page.getByRole("button", { name: "シリーズを作成" }).click();

    await expect(formMessage(page)).toContainText(/レーベルは必須/u);
    // Still on the create form — no redirect.
    await expect(page).toHaveURL(/\/series\/new/u);
  });

  test("他 tenant のシリーズは編集画面で見つからない", async ({ page }) => {
    applyScenarioSql(MULTI_TENANT_SCENARIO);

    const response = await page.goto(
      adminUrl(`/series/${OTHER_TENANT.publishedSeries.publicId}`)
    );
    // Cache Components commits the shell with 200. The resource itself is
    // either the console not-found page or an inline load error — never the
    // foreign series body (see (protected)/not-found.tsx and getSeries).
    expect(response?.status(), await page.content()).toBe(200);
    await expect(
      page.getByText(
        /ページが見つかりません|対象のシリーズが見つかりませんでした/u
      )
    ).toBeVisible();
    await expect(
      page.getByText(OTHER_TENANT.publishedSeries.title)
    ).toHaveCount(0);
    await expect(page.locator("#series_title")).toHaveCount(0);
  });
});
