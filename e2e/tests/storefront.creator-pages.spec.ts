import { readFile } from "node:fs/promises";

import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import { applyScenarioSql, runSql } from "../src/db";
import { revalidateStorefrontTags, tenantSiteTag } from "../src/revalidate";
import { SEED_TENANT_ID } from "../src/scenarios/auth";
import {
  CREATOR_PAGES_AUTHORS,
  CREATOR_PAGES_DECEMBER,
  CREATOR_PAGES_OTHER_AUTHORS_SERIES,
  CREATOR_PAGES_SCENARIO,
} from "../src/scenarios/creator-pages";
import { CREATOR_READER } from "../src/scenarios/creator-reader";
import { SEED_MEMBER } from "../src/scenarios/member-announcements";
import { signInAsMember } from "../src/storefront";
import { WEB_STOREFRONT_BASE_URL } from "../src/urls";

const [FIRST_AUTHOR, SECOND_AUTHOR] = CREATOR_PAGES_AUTHORS;

const AUTHOR_PAGES_LINK = "Your author pages";

const authorPath = (id: string) => `/my/creators/${id}`;

const statementPath = `${authorPath(FIRST_AUTHOR.id)}/statements/${CREATOR_PAGES_DECEMBER.period}`;

/** Whether the tenant shows its Authors their sales, written straight to Postgres. */
const showSales = (shown: boolean) => {
  runSql(
    `UPDATE tenant_config SET creator_pages_show_sales = ${shown} WHERE tenant_id = '${SEED_TENANT_ID}'`
  );
};

const statementsSection = (page: Page) =>
  page.getByRole("region", { name: "Closed statements" });

/**
 * The text of every body row of the statement's lines, which is all the page
 * says about the month beyond its totals.
 */
const lineRows = (page: Page) =>
  page
    .getByRole("table")
    .getByRole("row")
    .filter({ hasNot: page.getByRole("columnheader") });

/**
 * What a reader linked to Authors reads of them from My Page: each Author's
 * figures, the closed months with the lines that name them, and the download
 * of those lines. The pages and the sales are tenant settings, so the suite
 * applies them itself and runs in order.
 */
test.describe.configure({ mode: "serial" });

test.describe("web-storefront Author pages", () => {
  test.beforeAll(async () => {
    applyScenarioSql(CREATOR_PAGES_SCENARIO);
    // The scenario turns the pages on with a write no app saw, and My Page
    // reads the setting from the tenant read the storefront keeps.
    await revalidateStorefrontTags([tenantSiteTag(SEED_TENANT_ID)]);
  });

  test.afterAll(() => {
    showSales(true);
  });

  test("My Page leads a linked reader to the first Author, with a tab for the second", async ({
    page,
  }) => {
    await signInAsMember(page, CREATOR_READER, "/my", WEB_STOREFRONT_BASE_URL);

    // Revalidation marks the tenant read stale rather than dropping it, so
    // the link may take another load to appear.
    await expect(async () => {
      await page.reload();
      await expect(
        page.getByRole("link", { name: AUTHOR_PAGES_LINK })
      ).toBeVisible({ timeout: 2000 });
    }).toPass();

    await page.getByRole("link", { name: AUTHOR_PAGES_LINK }).click();
    await page.waitForURL(`**${authorPath(FIRST_AUTHOR.id)}`);

    await expect(
      page.getByRole("heading", { level: 1, name: FIRST_AUTHOR.name })
    ).toBeVisible();
    const tabs = page.getByRole("navigation", { name: "Your authors" });
    await expect(
      tabs.getByRole("link", { name: FIRST_AUTHOR.name })
    ).toHaveAttribute("aria-current", "page");

    await expect(page.getByRole("term")).toHaveText([
      "Followers",
      "Member views",
      "Completions",
      "Read-through rate",
    ]);
    await expect(
      page.getByRole("region", { name: "Episodes" }).getByRole("link", {
        name: "Seed Episode 001-10",
      })
    ).toBeVisible();

    await tabs.getByRole("link", { name: SECOND_AUTHOR.name }).click();
    await page.waitForURL(`**${authorPath(SECOND_AUTHOR.id)}`);
    await expect(
      page.getByRole("heading", { level: 1, name: SECOND_AUTHOR.name })
    ).toBeVisible();
  });

  test("a closed month lists only the lines naming the Author, and downloads them", async ({
    page,
  }) => {
    await signInAsMember(
      page,
      CREATOR_READER,
      authorPath(FIRST_AUTHOR.id),
      WEB_STOREFRONT_BASE_URL
    );

    const months = statementsSection(page);
    await expect(
      months.getByRole("link", { name: "November 2025" })
    ).toBeVisible();
    await months
      .getByRole("link", { name: CREATOR_PAGES_DECEMBER.label })
      .click();
    await page.waitForURL(`**${statementPath}`);

    await expect(
      page.getByRole("heading", {
        level: 1,
        name: `${CREATOR_PAGES_DECEMBER.label} statement`,
      })
    ).toBeVisible();
    await expect(page.getByRole("definition")).toHaveText([
      CREATOR_PAGES_DECEMBER.sales,
      CREATOR_PAGES_DECEMBER.gross,
      "¥0",
      CREATOR_PAGES_DECEMBER.payout,
    ]);

    const rows = lineRows(page);
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(1)).toContainText(CREATOR_PAGES_DECEMBER.adjustment);

    await expect(page.getByRole("table")).not.toContainText(
      new RegExp(CREATOR_PAGES_OTHER_AUTHORS_SERIES.join("|"), "u")
    );

    const downloading = page.waitForEvent("download");
    await page.getByRole("link", { name: "Download CSV" }).click();
    const download = await downloading;
    expect(download.suggestedFilename()).toBe(CREATOR_PAGES_DECEMBER.fileName);
    const csv = await readFile(await download.path(), "utf-8");
    const [header, ...body] = csv.split("\r\n").filter((row) => row !== "");
    expect(header).toBe(
      "\uFEFFperiod,role_name,series_id,series_title,episode_id,episode_title,sale_count,gross_amount,refunded_amount,share_percent,payout_amount,currency,adjusted_period,source"
    );
    expect(body).toEqual(CREATOR_PAGES_DECEMBER.csvRows);
  });

  test("with sales hidden, the pages show no amount and no statement", async ({
    page,
  }) => {
    showSales(false);

    try {
      await signInAsMember(
        page,
        CREATOR_READER,
        authorPath(FIRST_AUTHOR.id),
        WEB_STOREFRONT_BASE_URL
      );

      await expect(
        page.getByRole("heading", { level: 1, name: FIRST_AUTHOR.name })
      ).toBeVisible();
      await expect(
        page.getByRole("region", { name: "Episodes" }).getByRole("link", {
          name: "Seed Episode 001-10",
        })
      ).toBeVisible();
      await expect(
        page.getByRole("columnheader", { name: "Net amount" })
      ).toHaveCount(0);
      await expect(statementsSection(page)).toHaveCount(0);
      await expect(page.getByText("¥")).toHaveCount(0);

      await page.goto(`${WEB_STOREFRONT_BASE_URL}${statementPath}`);
      await expect(
        page.getByRole("heading", { level: 1, name: "Page not found" })
      ).toBeVisible();
    } finally {
      showSales(true);
    }
  });

  test("a reader linked to no Author sees no entry, and the pages send them to My Page", async ({
    page,
  }) => {
    await signInAsMember(page, SEED_MEMBER, "/my", WEB_STOREFRONT_BASE_URL);

    await expect(
      page.getByRole("heading", { level: 1, name: "My Page" })
    ).toBeVisible();
    // Every island of the header streams in, so the header has settled once
    // the link beside the one to settings is there.
    await expect(
      page.getByRole("link", { name: "Open settings" })
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: AUTHOR_PAGES_LINK })
    ).toHaveCount(0);

    await page.goto(`${WEB_STOREFRONT_BASE_URL}/my/creators`);
    await page.waitForURL((url) => url.pathname.endsWith("/my"));
  });
});
