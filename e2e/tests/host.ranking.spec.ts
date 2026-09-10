import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import { applyScenarioSql } from "../src/db";
import { MULTI_TENANT_SCENARIO } from "../src/scenarios/multi-tenant";
import {
  RANKING_COMPUTED_ON,
  RANKING_ENTRY_COUNT,
  RANKING_SERIES,
} from "../src/scenarios/ranking";
import { hostPath, WEB_HOST_OTHER_TENANT_BASE_URL } from "../src/urls";

/**
 * The ranking a reader sees: the numbered module the top page opens with, the
 * chart behind it, and the two periods that chart is kept in.
 *
 * The positions come from `db/seeds/scenarios/170_ranking.sql`, which
 * `task e2e:db` applies for the whole stack, so this suite seeds nothing of its
 * own. The last test is the other half of the module — a tenant the batch has
 * not ranked keeps the recommendation shelf — and that is the Boundary Tenant,
 * which nothing ranks.
 */

/** One row of the chart, found by the work it is about. */
const chartRow = (page: Page, title: string) =>
  page.locator("main ol > li").filter({ hasText: title });

test.describe("web-host ranking", () => {
  test("the top page opens the week's chart with its positions", async ({
    page,
  }) => {
    const response = await page.goto(hostPath("/"));
    expect(response?.status(), await page.content()).toBe(200);

    const chart = page.getByRole("region", { name: "Top 10 this week" });
    await expect(chart.getByText("No. 1", { exact: true })).toBeVisible();
    await expect(
      chart.getByRole("link", { name: RANKING_SERIES.climbed.title })
    ).toBeVisible();

    await chart.getByRole("link", { name: "View all" }).click();

    // `exact`: Playwright matches an accessible name as a case-insensitive
    // substring, and this page's own copy talks about the ranking throughout.
    await expect(
      page.getByRole("heading", { exact: true, level: 1, name: "Ranking" })
    ).toBeVisible();
  });

  test("the weekly chart states every position and how it moved", async ({
    page,
  }) => {
    await page.goto(hostPath("/ranking?period=weekly"));

    // The snapshot was computed at 21:00 UTC and this tenant is on Asia/Tokyo,
    // so the day on screen is the following one.
    await expect(
      page.getByText(`Updated ${RANKING_COMPUTED_ON}`)
    ).toBeVisible();
    await expect(page.locator("main ol > li")).toHaveCount(RANKING_ENTRY_COUNT);

    const climbed = chartRow(page, RANKING_SERIES.climbed.title);
    await expect(climbed).toContainText(
      `No. ${RANKING_SERIES.climbed.weeklyRank}`
    );
    await expect(climbed).toContainText(RANKING_SERIES.climbed.weeklyMovement);

    const entered = chartRow(page, RANKING_SERIES.held.title);
    await expect(entered).toContainText(
      `No. ${RANKING_SERIES.held.weeklyRank}`
    );
    await expect(entered).toContainText(RANKING_SERIES.held.weeklyMovement);

    const fell = chartRow(page, RANKING_SERIES.fell.title);
    await expect(fell).toContainText(`No. ${RANKING_SERIES.fell.weeklyRank}`);
    await expect(fell).toContainText(RANKING_SERIES.fell.weeklyMovement);
  });

  test("the daily tab is a chart of its own, and the URL says which", async ({
    page,
  }) => {
    await page.goto(hostPath("/ranking"));

    const held = chartRow(page, RANKING_SERIES.held.title);
    await expect(held).toContainText(`No. ${RANKING_SERIES.held.dailyRank}`);
    await expect(held).toContainText(RANKING_SERIES.held.dailyMovement);

    const entered = chartRow(page, RANKING_SERIES.entered.title);
    await expect(entered).toContainText(
      `No. ${RANKING_SERIES.entered.dailyRank}`
    );
    await expect(entered).toContainText(RANKING_SERIES.entered.dailyMovement);

    await page.getByRole("link", { name: "Weekly" }).click();

    await expect(page).toHaveURL(/period=weekly/u);
    await expect(chartRow(page, RANKING_SERIES.held.title)).toContainText(
      `No. ${RANKING_SERIES.held.weeklyRank}`
    );
  });

  test("a tenant the batch has not ranked keeps the recommendation shelf", async ({
    page,
  }) => {
    applyScenarioSql(MULTI_TENANT_SCENARIO);

    await page.goto(`${WEB_HOST_OTHER_TENANT_BASE_URL}${hostPath("/")}`);

    const shelf = page.getByRole("region", { name: "Recommended" });
    await expect(
      shelf.locator(`a[href^="${hostPath("/series/")}"]`).first()
    ).toBeVisible();
    await expect(shelf.getByRole("link", { name: "View all" })).toHaveAttribute(
      "href",
      hostPath("/series")
    );
    await expect(page.getByText("No. 1", { exact: true })).toHaveCount(0);
  });
});
