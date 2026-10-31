import { expect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";

import {
  createEpisodeViaUi,
  createSeriesViaUi,
  signInAsSeedAdmin,
} from "../src/admin";
import {
  deleteSeriesByPublicIds,
  querySql,
  quoteSqlLiteral,
  runSql,
} from "../src/db";
import {
  publishedAtOneHourAgo,
  uniqueSuffix,
} from "../src/scenarios/admin-publish";
import { WEB_ADMIN_BASE_URL } from "../src/urls";

const adminUrl = (pathname: string): string =>
  `${WEB_ADMIN_BASE_URL}${pathname}`;

/**
 * The section of a screen whose heading is `name`. The page body is a
 * `<section>` too, so the innermost one holding the heading is the section.
 */
const sectionNamed = (page: Page, name: string): Locator =>
  page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name }) })
    .last();

const freeAfterFields = (section: Locator) => ({
  daysAfterPublication: section.getByRole("spinbutton", {
    name: "Days after publication",
  }),
  enabled: section.getByRole("switch", {
    name: "Make episodes free after publication",
  }),
  excludedLatestCount: section.getByRole("spinbutton", {
    name: "Newest episodes that stay priced",
  }),
});

/**
 * Moves an episode's publication two days back. The console publishes an
 * episode given a past time at the moment it is saved, so no form reaches a
 * day a rule of one day has passed.
 */
const publishTwoDaysAgo = (episodePublicId: string): void => {
  runSql(`
    UPDATE episode_listings
    SET published_at = NOW() - INTERVAL '2 days'
    WHERE episode_id = (
      SELECT id FROM episodes WHERE public_id = ${quoteSqlLiteral(episodePublicId)}
    )
  `);
};

/** How many free reading periods a series rule has written on one episode. */
const ruleWindowCount = (episodePublicId: string): number =>
  Number(
    querySql(`
      SELECT COUNT(*)
      FROM episode_free_windows w
        JOIN episodes e ON e.id = w.episode_id
      WHERE e.public_id = ${quoteSqlLiteral(episodePublicId)}
        AND w.rule_series_id IS NOT NULL
    `)
  );

/**
 * Free after publication in the console: a series opens on the API's
 * defaults, a saved rule is what the screen and the audit log show afterwards,
 * and the period the worker adds under it is marked on the episode screen.
 */
test.describe("admin free-after-publication settings", () => {
  let createdSeriesIds: string[] = [];

  test.beforeEach(async ({ page }) => {
    createdSeriesIds = [];
    await signInAsSeedAdmin(page);
  });

  test.afterEach(() => {
    deleteSeriesByPublicIds(createdSeriesIds);
    createdSeriesIds = [];
  });

  test("saves a series' rule and records the change", async ({ page }) => {
    const suffix = uniqueSuffix();

    const seriesId = await createSeriesViaUi(page, {
      publishedAt: publishedAtOneHourAgo(),
      synopsis: `Free-after series ${suffix}`,
      title: `E2E Free After ${suffix}`,
    });

    createdSeriesIds.push(seriesId);

    await page.goto(adminUrl(`/series/${seriesId}`));

    const fields = freeAfterFields(
      sectionNamed(page, "Free after publication")
    );

    // A series nobody configured answers the API's defaults.
    await expect(fields.enabled).not.toBeChecked();
    await expect(fields.daysAfterPublication).toHaveValue("30");
    await expect(fields.excludedLatestCount).toHaveValue("0");

    // A click that lands before the switch hydrates does nothing, and
    // `check()` is a no-op once it holds.
    await expect(async () => {
      await fields.enabled.check({ timeout: 1000 });
    }).toPass();
    await fields.daysAfterPublication.fill("30");
    await fields.excludedLatestCount.fill("2");
    await sectionNamed(page, "Free after publication")
      .getByRole("button", { name: "Save free-after settings" })
      .click();

    await expect(page.getByText("Free-after settings saved.")).toBeVisible();

    // Read back from the API rather than from what the form still held.
    await page.reload();
    const saved = freeAfterFields(sectionNamed(page, "Free after publication"));
    await expect(saved.enabled).toBeChecked();
    await expect(saved.daysAfterPublication).toHaveValue("30");
    await expect(saved.excludedLatestCount).toHaveValue("2");

    await page.goto(
      adminUrl("/audit-logs?action=series_free_after_settings_updated")
    );
    await expect(
      page
        .getByRole("row")
        .filter({ hasText: `Series / ${seriesId}` })
        .filter({ hasText: "Free-after settings updated" })
    ).toHaveCount(1);
  });

  test("marks the period the rule adds on the episode screen", async ({
    page,
  }) => {
    const suffix = uniqueSuffix();

    const seriesId = await createSeriesViaUi(page, {
      publishedAt: publishedAtOneHourAgo(),
      synopsis: `Free-after episode ${suffix}`,
      title: `E2E Free After Episode ${suffix}`,
    });

    createdSeriesIds.push(seriesId);

    const episodeId = await createEpisodeViaUi(page, {
      price: 100,
      publishAt: publishedAtOneHourAgo(),
      seriesPublicId: seriesId,
      title: `E2E Free After Episode ${suffix}`,
    });

    // A rule of one day has reached it.
    publishTwoDaysAgo(episodeId);

    await page.goto(adminUrl(`/series/${seriesId}`));

    const fields = freeAfterFields(
      sectionNamed(page, "Free after publication")
    );

    await expect(async () => {
      await fields.enabled.check({ timeout: 1000 });
    }).toPass();
    await fields.daysAfterPublication.fill("1");
    await fields.excludedLatestCount.fill("0");
    await sectionNamed(page, "Free after publication")
      .getByRole("button", { name: "Save free-after settings" })
      .click();
    await expect(page.getByText("Free-after settings saved.")).toBeVisible();

    // The worker writes the period on its next pass. The episode screen is
    // opened only once it has, so the list it caches already holds it.
    await expect.poll(() => ruleWindowCount(episodeId)).toBe(1);

    await page.goto(adminUrl(`/series/${seriesId}/episodes/${episodeId}`));

    const row = sectionNamed(page, "Free reading periods").getByRole(
      "listitem"
    );

    await expect(row).toHaveCount(1);
    await expect(row.getByText("By the series rule")).toBeVisible();
    await expect(row.getByText("Free now", { exact: true })).toBeVisible();
    await expect(row.getByRole("button", { name: "Delete" })).toHaveCount(0);
  });
});
