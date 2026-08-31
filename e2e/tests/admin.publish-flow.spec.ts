import { expect, test } from "@playwright/test";

import {
  createEpisodeViaUi,
  createSeriesViaUi,
  formMessage,
  seriesFormFields,
  signInAsSeedAdmin,
} from "../src/admin";
import {
  applyScenarioSql,
  deleteSeriesByPublicIds,
  querySql,
  runSql,
} from "../src/db";
import {
  publishedAtOneHourAgo,
  scheduleAtFiveMinutesFromNow,
  uniqueSuffix,
} from "../src/scenarios/admin-publish";
import {
  MULTI_TENANT_SCENARIO,
  OTHER_TENANT,
} from "../src/scenarios/multi-tenant";
import { hostPath, WEB_ADMIN_BASE_URL, WEB_HOST_BASE_URL } from "../src/urls";

const hostUrl = (pathname: string): string =>
  `${WEB_HOST_BASE_URL}${hostPath(pathname)}`;

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
 * Login is a prerequisite helper (auth coverage is `admin.auth.spec.ts`). Each test uses a
 * unique title so runs do not depend on leftover rows from a previous suite.
 * Series created during the suite are deleted in `afterEach` so `task e2e:test`
 * against a long-lived stack does not accumulate rows.
 */
test.describe("admin publish flow", () => {
  /** Series public_ids created in the current test; drained by afterEach. */
  let createdSeriesIds: string[] = [];

  test.beforeEach(async ({ page }) => {
    createdSeriesIds = [];
    await signInAsSeedAdmin(page);
  });

  test.afterEach(() => {
    deleteSeriesByPublicIds(createdSeriesIds);
    createdSeriesIds = [];
  });

  const trackSeries = (publicId: string): string => {
    createdSeriesIds.push(publicId);
    return publicId;
  };

  test("creates a draft series and shows the edit back in the console", async ({
    page,
  }) => {
    const suffix = uniqueSuffix();
    const title = `E2E Draft Series ${suffix}`;
    const synopsis = `下書き概要 ${suffix}`;

    const seriesId = trackSeries(
      await createSeriesViaUi(page, { synopsis, title })
    );

    await expect(page).toHaveURL(new RegExp(`/series/${seriesId}`, "u"));
    const fields = seriesFormFields(page);
    await expect(fields.title).toHaveValue(title);
    await expect(fields.synopsis).toHaveValue(synopsis);
    // Draft: published_at left empty.
    await expect(fields.publishedAt).toHaveValue("");

    const editedTitle = `${title} (edited)`;
    const editedSynopsis = `${synopsis} (edited)`;
    await fields.title.fill(editedTitle);
    await fields.synopsis.fill(editedSynopsis);
    await page.getByRole("button", { name: "シリーズを更新" }).click();
    // FlashToast strips `?updated=1` via client replace; assert on values
    // rather than waiting for a load event that may never re-fire.
    await expect(fields.title).toHaveValue(editedTitle, {
      timeout: 30_000,
    });
    await expect(fields.synopsis).toHaveValue(editedSynopsis);

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

  test("publishing a series makes it visible on the same tenant's web-host", async ({
    page,
  }) => {
    const suffix = uniqueSuffix();
    const title = `E2E Published Series ${suffix}`;
    const synopsis = `公開概要 ${suffix}`;
    // Past wall clock → immediate publish on create.
    const seriesId = trackSeries(
      await createSeriesViaUi(page, {
        publishedAt: publishedAtOneHourAgo(),
        synopsis,
        title,
      })
    );

    const fields = seriesFormFields(page);
    await expect(fields.title).toHaveValue(title);
    await expect(fields.publishedAt).not.toHaveValue("");

    // Brand-new public_id: first host request misses cache and hits public API.
    const response = await page.goto(hostUrl(`/series/${seriesId}`));
    expect(response?.status(), await page.content()).toBe(200);
    await expect(
      page.getByRole("heading", { level: 1, name: title })
    ).toBeVisible();
    await expect(page.getByText(synopsis)).toBeVisible();
  });

  test("submits and schedules an episode, and it reaches web-host once published", async ({
    page,
  }) => {
    const suffix = uniqueSuffix();
    const seriesTitle = `E2E Episode Parent ${suffix}`;
    const episodeTitle = `E2E Episode ${suffix}`;

    const seriesId = trackSeries(
      await createSeriesViaUi(page, {
        publishedAt: publishedAtOneHourAgo(),
        synopsis: `親シリーズ ${suffix}`,
        title: seriesTitle,
      })
    );

    // Schedule far enough ahead for minute-precision datetime-local and slow
    // CI. Nudge scheduled_at into the past after create so the worker fires
    // without waiting out the wall clock.
    const episodeId = await createEpisodeViaUi(page, {
      publishAt: scheduleAtFiveMinutesFromNow(),
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

  test("a missing required field shows an error", async ({ page }) => {
    await page.goto(adminUrl("/series/new"));
    const fields = seriesFormFields(page);
    await fields.title.fill(`E2E Invalid ${uniqueSuffix()}`);
    await fields.synopsis.fill("概要だけ埋めた不完全な入力");
    // Intentionally skip label selection.
    await page.getByRole("button", { name: "シリーズを作成" }).click();

    await expect(formMessage(page)).toContainText(/レーベルは必須/u);
    // Still on the create form — no redirect.
    await expect(page).toHaveURL(/\/series\/new/u);
  });

  test("another tenant's series is not found in the edit screen", async ({
    page,
  }) => {
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
    await expect(seriesFormFields(page).title).toHaveCount(0);
  });
});
