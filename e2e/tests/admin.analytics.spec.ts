import { readFile } from "node:fs/promises";

import type { Download, Locator, Page } from "@playwright/test";
import { expect, test } from "@playwright/test";

import { signInAsAdmin } from "../src/admin";
import { applyScenarioSql } from "../src/db";
import {
  ADMIN_ANALYTICS_SCENARIO,
  ANALYTICS_ADMIN,
  ANALYTICS_AUDIENCE,
  ANALYTICS_DROP_OFF,
  ANALYTICS_EPISODES,
  ANALYTICS_REVENUE,
  ANALYTICS_SERIES,
  ANALYTICS_TENANT,
  ANALYTICS_WEEK,
} from "../src/scenarios/admin-analytics";
import { WEB_ADMIN_ANALYTICS_BASE_URL } from "../src/urls";

const weekQuery = (params: Record<string, string> = {}): string =>
  `?${new URLSearchParams({
    from: ANALYTICS_WEEK.from,
    to: ANALYTICS_WEEK.to,
    ...params,
  }).toString()}`;

const adminUrl = (path: string): string =>
  new URL(path, WEB_ADMIN_ANALYTICS_BASE_URL).toString();

const signIn = (page: Page, path: string) =>
  signInAsAdmin(page, ANALYTICS_ADMIN, path, WEB_ADMIN_ANALYTICS_BASE_URL);

/**
 * The figure beside one label of the summary line: a description list, so the
 * value is the `<dd>` that follows the `<dt>` carrying the label.
 */
const summaryValue = (page: Page, label: string): Locator =>
  page
    .locator("dt")
    .filter({ hasText: new RegExp(`^${label}$`, "u") })
    .locator("xpath=following-sibling::dd[1]");

/** The body rows of the breakdown table, in the order shown. */
const tableRows = (page: Page): Locator =>
  page.getByRole("main").locator("tbody tr");

const firstCells = (page: Page): Promise<string[]> =>
  tableRows(page).locator("td:first-child").allTextContents();

/** Every cell's text, row by row. */
const rowTexts = (page: Page): Promise<(string | null)[][]> =>
  tableRows(page).evaluateAll((rows) =>
    rows.map((row) =>
      [...row.querySelectorAll("td")].map((cell) => cell.textContent)
    )
  );

/** Clicks **Download CSV** and waits for the file it saves. */
const downloadCsv = async (page: Page): Promise<Download> => {
  const downloading = page.waitForEvent("download");
  await page.getByRole("link", { exact: true, name: "Download CSV" }).click();
  return downloading;
};

/** A downloaded CSV's header and body rows, split on its CRLF endings. */
const csvRows = async (download: Download): Promise<string[]> => {
  const csv = await readFile(await download.path(), "utf-8");
  return csv.split("\r\n").filter((row) => row !== "");
};

const sortHeading = (page: Page, name: string): Locator =>
  page.getByRole("columnheader", { exact: true, name });

/**
 * The console's analytics section on a tenant of its own, whose one week of
 * sales, follows, reads, and page reach `690_admin_analytics.sql` pins to
 * 2025-03-03 through 2025-03-09, so every figure is asserted exactly.
 */
test.describe("admin analytics", () => {
  test.beforeAll(() => {
    applyScenarioSql(ADMIN_ANALYTICS_SCENARIO);
  });

  test("Revenue totals the week, and its breakdowns sort by any column", async ({
    page,
  }) => {
    await signIn(page, `/analytics/revenue${weekQuery()}`);
    await expect(
      page.getByRole("heading", { level: 1, name: "Revenue" })
    ).toBeVisible();

    await expect(summaryValue(page, "Purchases")).toHaveText(
      ANALYTICS_REVENUE.purchases
    );
    await expect(summaryValue(page, "Gross sales")).toHaveText(
      ANALYTICS_REVENUE.gross
    );
    await expect(summaryValue(page, "Refunded")).toHaveText(
      ANALYTICS_REVENUE.refunded
    );
    await expect(summaryValue(page, "Net sales")).toHaveText(
      ANALYTICS_REVENUE.net
    );
    await expect(
      page.getByRole("img", { name: "Net sales per day" })
    ).toBeVisible();
    // A row for every day of the week, the quiet ones included.
    await expect(tableRows(page)).toHaveCount(ANALYTICS_WEEK.days);

    // The breakdown is a link, so it keeps the period beside it.
    await page.getByRole("link", { exact: true, name: "By series" }).click();
    await expect(page).toHaveURL(/[?&]group=series/u);
    await expect(page).toHaveURL(/[?&]from=2025-03-03/u);
    await expect
      .poll(() => firstCells(page))
      .toEqual(ANALYTICS_REVENUE.series.map((row) => row.title));
    await expect(sortHeading(page, "Net")).toHaveAttribute(
      "aria-sort",
      "descending"
    );
    const [first] = ANALYTICS_REVENUE.series;
    const firstRow = tableRows(page).first();
    await expect(firstRow.getByRole("cell").nth(1)).toHaveText(first.purchases);
    await expect(firstRow.getByRole("cell").nth(4)).toHaveText(first.net);

    // Net again turns the order round.
    await sortHeading(page, "Net").getByRole("link").click();
    await expect(page).toHaveURL(/[?&]sort=net(?:&|$)/u);
    await expect(page).toHaveURL(/[?&]order=asc(?:&|$)/u);
    await expect
      .poll(() => firstCells(page))
      .toEqual(ANALYTICS_REVENUE.series.map((row) => row.title).toReversed());
    await expect(sortHeading(page, "Net")).toHaveAttribute(
      "aria-sort",
      "ascending"
    );

    // By episode, sorted by its title.
    await page.goto(
      adminUrl(`/analytics/revenue${weekQuery({ group: "episode" })}`)
    );
    await sortHeading(page, "Episode").getByRole("link").click();
    await expect(page).toHaveURL(/[?&]sort=episode(?:&|$)/u);
    await expect(page).toHaveURL(/[?&]order=asc(?:&|$)/u);
    await expect
      .poll(() => tableRows(page).locator("td:nth-child(2)").allTextContents())
      .toEqual([
        ANALYTICS_EPISODES.first.title,
        ANALYTICS_EPISODES.second.title,
        ANALYTICS_EPISODES.third.title,
      ]);
  });

  test("a period that cannot be reported is refused next to the form", async ({
    page,
  }) => {
    await signIn(page, `/analytics/revenue${weekQuery()}`);

    await page.getByLabel("From", { exact: true }).fill(ANALYTICS_WEEK.to);
    await page.getByLabel("To", { exact: true }).fill(ANALYTICS_WEEK.from);
    await page.getByRole("button", { exact: true, name: "Apply" }).click();

    await expect(page).toHaveURL(/[?&]from=2025-03-09/u);
    await expect(
      page.getByText(
        "The start of the period is after its end. Choose a start on or before the end."
      )
    ).toBeVisible();
    await expect(summaryValue(page, "Net sales")).toHaveCount(0);

    // Reset is a link to the screen's own path, which drops the dates.
    await page.getByRole("link", { exact: true, name: "Reset" }).click();
    await expect(page).toHaveURL(adminUrl("/analytics/revenue"));
  });

  test("Audience counts the week's followers, views, and reactions", async ({
    page,
  }) => {
    await signIn(page, `/analytics/audience${weekQuery()}`);
    await expect(
      page.getByRole("heading", { level: 1, name: "Audience" })
    ).toBeVisible();

    await expect(summaryValue(page, "Followers")).toHaveText(
      ANALYTICS_AUDIENCE.followers
    );
    await expect(summaryValue(page, "Views")).toHaveText(
      ANALYTICS_AUDIENCE.views
    );
    await expect(summaryValue(page, "Completions")).toHaveText(
      ANALYTICS_AUDIENCE.completions
    );
    await expect(summaryValue(page, "Reactions")).toHaveText(
      ANALYTICS_AUDIENCE.reactions
    );
    await expect(
      page.getByRole("img", { name: "Followers at the end of each day" })
    ).toBeVisible();
    await expect(tableRows(page)).toHaveCount(ANALYTICS_WEEK.days);

    await page.getByRole("link", { exact: true, name: "By series" }).click();
    await expect
      .poll(() => firstCells(page))
      .toEqual(ANALYTICS_AUDIENCE.series.map((row) => row.title));
    // Followers, follows, unfollows, and views, and no rating, since no
    // reader has rated either series.
    await expect
      .poll(() => rowTexts(page))
      .toEqual(
        ANALYTICS_AUDIENCE.series.map((row) => [
          row.title,
          row.followers,
          row.followed,
          row.unfollowed,
          row.views,
          expect.any(String),
          expect.any(String),
          "—",
          expect.any(String),
        ])
      );

    // Unfollows, the most first.
    await sortHeading(page, "Unfollows").getByRole("link").click();
    await expect(page).toHaveURL(/[?&]sort=unfollowed(?:&|$)/u);
    await expect(page).toHaveURL(/[?&]order=desc(?:&|$)/u);
    await expect
      .poll(() => firstCells(page))
      .toEqual([ANALYTICS_SERIES.second.title, ANALYTICS_SERIES.first.title]);
  });

  test("Download CSV saves the report each table shows, over its period", async ({
    page,
  }) => {
    await signIn(
      page,
      `/analytics/revenue${weekQuery({ group: "series", order: "asc", sort: "net" })}`
    );
    const revenue = await downloadCsv(page);
    expect(revenue.suggestedFilename()).toBe(
      `revenue-by-series-${ANALYTICS_TENANT.publicId}-${ANALYTICS_WEEK.from}--${ANALYTICS_WEEK.to}.csv`
    );
    const [revenueHeader, ...revenueRows] = await csvRows(revenue);
    expect(revenueHeader).toBe(
      "\uFEFFstart_date,end_date,series_id,series_title,purchase_count,gross_amount,refunded_amount,net_amount,currency"
    );
    // The report's own order, highest net first, whatever the table's sort.
    expect(revenueRows).toEqual(
      ANALYTICS_REVENUE.series.map((row) =>
        expect.stringMatching(
          new RegExp(
            `^${ANALYTICS_WEEK.from},${ANALYTICS_WEEK.to},${row.publicId},${row.title},${row.purchases},\\d+,\\d+,${row.netAmount},JPY$`,
            "u"
          )
        )
      )
    );

    await page.goto(
      adminUrl(
        `/analytics/episodes/${ANALYTICS_SERIES.first.publicId}/${ANALYTICS_EPISODES.first.publicId}${weekQuery()}`
      )
    );
    const dropOff = await downloadCsv(page);
    expect(dropOff.suggestedFilename()).toBe(
      `drop-off-${ANALYTICS_TENANT.publicId}-${ANALYTICS_EPISODES.first.publicId}-${ANALYTICS_WEEK.from}--${ANALYTICS_WEEK.to}.csv`
    );
    expect(await csvRows(dropOff)).toEqual([
      "\uFEFFstart_date,end_date,episode_id,page_index,reader_count",
      ...ANALYTICS_DROP_OFF.pages.map(
        (row, index) =>
          `${ANALYTICS_WEEK.from},${ANALYTICS_WEEK.to},${ANALYTICS_EPISODES.first.publicId},${index},${row.readers}`
      ),
    ]);
  });

  test("an episode's drop-off is opened from Episodes and counts each page", async ({
    page,
  }) => {
    await signIn(page, "/analytics/episodes");
    await expect(
      page.getByRole("heading", { level: 1, name: "Episodes" })
    ).toBeVisible();

    await page
      .getByRole("link", { exact: true, name: ANALYTICS_EPISODES.first.title })
      .click();
    await expect(page).toHaveURL(
      new RegExp(
        `/analytics/episodes/${ANALYTICS_SERIES.first.publicId}/${ANALYTICS_EPISODES.first.publicId}$`,
        "u"
      )
    );
    await expect(
      page.getByRole("heading", { level: 1, name: "Drop-off" })
    ).toBeVisible();
    await expect(
      page.getByText(
        `${ANALYTICS_SERIES.first.title} › ${ANALYTICS_EPISODES.first.title}`
      )
    ).toBeVisible();

    await page.getByLabel("From", { exact: true }).fill(ANALYTICS_WEEK.from);
    await page.getByLabel("To", { exact: true }).fill(ANALYTICS_WEEK.to);
    await page.getByRole("button", { exact: true, name: "Apply" }).click();
    await expect(page).toHaveURL(/[?&]to=2025-03-09/u);

    await expect(summaryValue(page, "Readers")).toHaveText(
      ANALYTICS_DROP_OFF.readers
    );
    await expect(summaryValue(page, "Reached the last page")).toHaveText(
      ANALYTICS_DROP_OFF.lastPageReaders
    );
    await expect(summaryValue(page, "Pages")).toHaveText(
      ANALYTICS_DROP_OFF.pageCount
    );
    await expect(
      page.getByRole("img", { name: "Readers who reached each page" })
    ).toBeVisible();
    await expect
      .poll(() => rowTexts(page))
      .toEqual(
        ANALYTICS_DROP_OFF.pages.map((row) => [
          row.page,
          row.readers,
          row.share,
          row.left,
        ])
      );

    // The page most readers left at comes first.
    await sortHeading(page, "Left here").getByRole("link").click();
    await expect(page).toHaveURL(/[?&]sort=left(?:&|$)/u);
    await expect(page).toHaveURL(/[?&]order=desc(?:&|$)/u);
    await expect
      .poll(() => firstCells(page))
      .toEqual(
        ANALYTICS_DROP_OFF.pages
          .toSorted((a, b) => Number(b.left) - Number(a.left))
          .map((row) => row.page)
      );
  });
});
