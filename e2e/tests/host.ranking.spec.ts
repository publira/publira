import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import { applyScenarioSql } from "../src/db";
import {
  RANKING_COMPUTED_ON,
  RANKING_SCENARIO,
  RANKING_SERIES,
} from "../src/scenarios/ranking";
import { hostPath, WEB_HOST_RANKING_BASE_URL } from "../src/urls";

/**
 * The ranking a reader sees: the numbered module the top page opens with, the
 * chart behind it, and the two periods that chart is kept in.
 *
 * It runs on the tenant of `170_ranking.sql`, the only one carrying a ranking
 * snapshot: the snapshot decides what the popularity module shows for a whole
 * tenant, so on the development seed tenant it would rewrite the module
 * `catalog.browse.spec.ts` reads and the home page the screenshot baseline
 * holds.
 */

const rankingUrl = (pathname: string): string =>
  `${WEB_HOST_RANKING_BASE_URL}${hostPath(pathname)}`;

/** One row of the chart, found by the work it is about. */
const chartRow = (page: Page, title: string) =>
  page.locator("main ol > li").filter({ hasText: title });

test.describe("web-host ranking", () => {
  test.beforeAll(() => {
    applyScenarioSql(RANKING_SCENARIO);
  });

  test("the top page opens the week's chart with its positions", async ({
    page,
  }) => {
    const response = await page.goto(rankingUrl("/"));
    expect(response?.status(), await page.content()).toBe(200);

    const chart = page.getByRole("region", { name: "Top 10 this week" });
    await expect(chart.getByText("No. 1", { exact: true })).toBeVisible();
    await expect(
      chart.getByRole("link", { name: RANKING_SERIES.second.title })
    ).toBeVisible();

    await chart.getByRole("link", { name: "View all" }).click();

    // `exact`: the tenant is called "Ranking Tenant", and Playwright matches an
    // accessible name as a case-insensitive substring.
    await expect(
      page.getByRole("heading", { exact: true, level: 1, name: "Ranking" })
    ).toBeVisible();
  });

  test("the weekly chart states every position and how it moved", async ({
    page,
  }) => {
    await page.goto(rankingUrl("/ranking?period=weekly"));

    // The snapshot was computed at 21:00 UTC and this tenant is on Asia/Tokyo,
    // so the day on screen is the following one.
    await expect(
      page.getByText(`Updated ${RANKING_COMPUTED_ON}`)
    ).toBeVisible();

    const climbed = chartRow(page, RANKING_SERIES.second.title);
    await expect(climbed).toContainText("No. 1");
    await expect(climbed).toContainText("Up 2");

    const entered = chartRow(page, RANKING_SERIES.third.title);
    await expect(entered).toContainText("No. 2");
    await expect(entered).toContainText("New");

    const fell = chartRow(page, RANKING_SERIES.first.title);
    await expect(fell).toContainText("No. 3");
    await expect(fell).toContainText("Down 2");
  });

  test("the daily tab is a chart of its own, and the URL says which", async ({
    page,
  }) => {
    await page.goto(rankingUrl("/ranking"));

    const held = chartRow(page, RANKING_SERIES.first.title);
    await expect(held).toContainText("No. 1");
    await expect(held).toContainText("No change");

    // Ranked daily for the first time: the day before listed another work.
    const entered = chartRow(page, RANKING_SERIES.second.title);
    await expect(entered).toContainText("No. 2");
    await expect(entered).toContainText("New");

    await expect(page.locator("main ol > li")).toHaveCount(2);

    await page.getByRole("link", { name: "Weekly" }).click();

    await expect(page).toHaveURL(/period=weekly/u);
    await expect(page.locator("main ol > li")).toHaveCount(3);
  });
});
