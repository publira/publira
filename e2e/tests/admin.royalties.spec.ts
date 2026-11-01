import { readFile } from "node:fs/promises";

import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";

import { signInAsAdmin } from "../src/admin";
import { applyScenarioSql, runSql } from "../src/db";
import {
  ROYALTIES_ADMIN,
  ROYALTIES_SALES,
  ROYALTIES_SCENARIO,
  ROYALTIES_SUBSCRIPTION,
  ROYALTIES_TENANT,
} from "../src/scenarios/royalties";
import { WEB_ADMIN_ROYALTIES_BASE_URL } from "../src/urls";

/**
 * A publisher reviewing a month of creator royalties, subscription payments
 * included, and closing it into a statement, and a publisher whose months
 * close on their own.
 */

const openMonthPath = (period: string): string => `/royalties?period=${period}`;

const signIn = (page: Page, nextPath: string): Promise<void> =>
  signInAsAdmin(page, ROYALTIES_ADMIN, nextPath, WEB_ADMIN_ROYALTIES_BASE_URL);

/**
 * Every body row of the lines table, author headings and subtotals included,
 * read once each of the scenario's two subtotal labels has streamed in.
 */
const lineRows = async (page: Page): Promise<string[]> => {
  const rows = page.getByRole("table").locator("tbody tr");
  await expect(rows.getByText("Subtotal", { exact: true })).toHaveCount(2);

  return rows.allInnerTexts();
};

test.beforeAll(() => {
  applyScenarioSql(ROYALTIES_SCENARIO);
});

test.afterAll(() => {
  applyScenarioSql(ROYALTIES_SCENARIO);
});

test.describe("royalties", () => {
  test("counts a subscription payment on Revenue on the day it was paid", async ({
    page,
  }) => {
    await signIn(
      page,
      `/analytics/revenue?from=${ROYALTIES_SUBSCRIPTION.paidOn}&to=${ROYALTIES_SUBSCRIPTION.periodEnd}`
    );

    const summary = (label: string) =>
      page
        .locator("dt")
        .filter({ hasText: new RegExp(`^${label}$`, "u") })
        .locator("xpath=following-sibling::dd[1]");

    await expect(summary("Subscriptions")).toHaveText(
      ROYALTIES_SUBSCRIPTION.amount
    );
    await expect(summary("Subscription refunds")).toHaveText("¥0");
    // Net sales counts the payment beside the purchases.
    await expect(summary("Net sales")).toHaveText(ROYALTIES_SALES.gross);
    await expect(
      page.getByRole("img", { name: "Net sales per day" })
    ).toBeVisible();
    await expect(
      page.getByRole("listitem").filter({ hasText: /^Subscriptions$/u })
    ).toBeVisible();

    // The first day, on which the payment was made and nothing was bought:
    // its Subscriptions cell and its Net are the payment.
    await expect(
      page.getByRole("columnheader", { name: "Subscriptions" })
    ).toBeVisible();

    const paidOn = page
      .getByRole("main")
      .locator("tbody tr")
      .first()
      .getByRole("cell");

    await expect(paidOn.nth(1)).toHaveText("0");
    await expect(paidOn.nth(4)).toHaveText(ROYALTIES_SUBSCRIPTION.amount);
    await expect(paidOn.nth(6)).toHaveText(ROYALTIES_SUBSCRIPTION.amount);

    // A payment belongs to no series, so the breakdown by series has no
    // column for it.
    await page.getByRole("link", { exact: true, name: "By series" }).click();
    await expect(page).toHaveURL(/[?&]group=series/u);
    await expect(
      page.getByRole("columnheader", { name: "Subscriptions" })
    ).toHaveCount(0);
  });

  test("closes a month into a statement that holds the lines it previewed", async ({
    page,
  }) => {
    await signIn(page, openMonthPath(ROYALTIES_SALES.period));

    await expect(
      page.getByText(`Open month: ${ROYALTIES_SALES.periodLabel}`)
    ).toBeVisible();
    // The month's totals, not a line's gross, which happens to be the same.
    await expect(
      page.getByRole("definition").filter({ hasText: ROYALTIES_SALES.gross })
    ).toBeVisible();
    await expect(
      page.getByRole("rowheader", { name: ROYALTIES_SALES.artist })
    ).toBeVisible();
    await expect(
      page.getByRole("rowheader", { name: ROYALTIES_SALES.writer })
    ).toBeVisible();
    const previewed = await lineRows(page);
    expect(previewed.join("\n")).toContain(ROYALTIES_SALES.artistPayout);
    expect(previewed.join("\n")).toContain(ROYALTIES_SALES.writerPayout);

    // The payment is a line of its own under each author, marked as such,
    // with the author's sales and subscription shares subtotalled apart.
    const shares = previewed.filter((row) =>
      row.includes("Subscription share")
    );

    expect(shares).toHaveLength(2);
    expect(shares).toEqual(
      expect.arrayContaining([
        expect.stringContaining(ROYALTIES_SUBSCRIPTION.artistShare),
        expect.stringContaining(ROYALTIES_SUBSCRIPTION.writerShare),
      ])
    );
    expect(
      previewed.filter((row) => row.startsWith("Subscription subtotal"))
    ).toHaveLength(2);
    expect(previewed.filter((row) => row.startsWith("Subtotal"))).toEqual(
      expect.arrayContaining([
        expect.stringContaining(ROYALTIES_SUBSCRIPTION.artistSubtotal),
        expect.stringContaining(ROYALTIES_SUBSCRIPTION.writerSubtotal),
      ])
    );

    await page.getByRole("button", { name: "Close month" }).click();
    const dialog = page.getByRole("alertdialog");
    await expect(
      dialog.getByText(`Close ${ROYALTIES_SALES.periodLabel}?`)
    ).toBeVisible();
    await expect(
      dialog.getByText(`${ROYALTIES_SALES.totalPayout} in total`, {
        exact: false,
      })
    ).toBeVisible();
    await dialog.getByRole("button", { name: "Close month" }).click();

    await page.waitForURL(
      (url) =>
        url.pathname === `/royalties/statements/${ROYALTIES_SALES.period}`
    );
    await expect(page.getByText("The month was closed.")).toBeVisible();
    await expect(
      page.getByText(`Closed on`, { exact: false }).first()
    ).toContainText(ROYALTIES_ADMIN.name);
    await expect(
      page.getByRole("rowheader", { name: ROYALTIES_SALES.artist })
    ).toBeVisible();
    expect(await lineRows(page)).toEqual(previewed);

    const downloading = page.waitForEvent("download");
    await page.getByRole("link", { name: "Download CSV" }).click();
    const download = await downloading;
    expect(download.suggestedFilename()).toBe(
      `royalties-${ROYALTIES_TENANT.publicId}-${ROYALTIES_SALES.period}.csv`
    );
    const csv = await readFile(await download.path(), "utf-8");
    const [header, ...rows] = csv.split("\r\n").filter((row) => row !== "");
    expect(header).toMatch(/^\uFEFFperiod,creator_id,creator_name,/u);
    expect(header).toMatch(/,source$/u);
    expect(rows).toHaveLength(4);
    expect(rows.join("\n")).toContain(`${ROYALTIES_SALES.artist},`);
    expect(rows.join("\n")).toContain(`${ROYALTIES_SALES.writer},`);
    expect(rows.filter((row) => row.endsWith(",subscription"))).toHaveLength(2);

    await page.goto(
      `${WEB_ADMIN_ROYALTIES_BASE_URL}${openMonthPath(ROYALTIES_SALES.period)}`
    );
    await expect(
      page.getByText("This month cannot be previewed")
    ).toBeVisible();

    await page.getByRole("link", { name: "Closed statements" }).first().click();
    await expect(
      page.getByRole("link", {
        exact: true,
        name: ROYALTIES_SALES.periodLabel,
      })
    ).toBeVisible();
    await expect(
      page.getByRole("link", {
        name: `Download the CSV for ${ROYALTIES_SALES.periodLabel}`,
      })
    ).toHaveAttribute(
      "href",
      `/api/v1/royalties/statements/${ROYALTIES_SALES.period}/csv`
    );
  });

  test("switches to automatic closing from the settings and leaves earlier months manual", async ({
    page,
  }) => {
    // The scenario's tenant keeps the default zone, UTC, so its months are
    // counted in UTC here too.
    const today = Temporal.Now.plainDateISO("UTC");
    const currentPeriod = today.toPlainYearMonth().toString();

    const previousPeriod = today
      .toPlainYearMonth()
      .subtract({ months: 1 })
      .toString();

    const closeDate = today
      .with({ day: 1 })
      .add({ months: 1 })
      .with({ day: 5 })
      .toLocaleString("en-US", {
        day: "numeric",
        month: "short",
        year: "numeric",
      });

    await signIn(page, "/royalties");
    await page.getByRole("link", { name: "Closing settings" }).click();
    await expect(page).toHaveURL(/\/royalties\/settings$/u);

    const automatic = page.getByRole("radio", { name: /Close automatically/u });
    await expect(
      page.getByRole("radio", { name: /Close each month myself/u })
    ).toBeChecked();
    await automatic.click();
    await page
      .getByRole("button", { name: "Save the closing settings" })
      .click();
    await expect(
      page.getByText("Choose the day of the following month on which to close.")
    ).toBeVisible();

    await page.getByRole("combobox", { name: /Close day/u }).click();
    await page.getByRole("option", { exact: true, name: "Day 5" }).click();
    await page
      .getByRole("button", { name: "Save the closing settings" })
      .click();
    await expect(
      page.getByText("The closing settings were saved.")
    ).toBeVisible();

    await page.reload();
    await expect(automatic).toBeChecked();
    await expect(
      page.getByRole("combobox", { name: /Close day/u })
    ).toContainText("Day 5");

    await page.goto(
      `${WEB_ADMIN_ROYALTIES_BASE_URL}${openMonthPath(currentPeriod)}`
    );
    await expect(
      page.getByText(`This month closes automatically on ${closeDate}.`)
    ).toBeVisible();

    await page.goto(
      `${WEB_ADMIN_ROYALTIES_BASE_URL}${openMonthPath(previousPeriod)}`
    );
    await expect(
      page.getByText("This month is over and ready to close.")
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Close month" })
    ).toBeVisible();
  });

  test("names the automatic close date and offers no close button", async ({
    page,
  }) => {
    runSql(`
      INSERT INTO tenant_royalty_config (tenant_id, close_mode, auto_close_day, automatic_since)
      SELECT id, 'automatic', 5, '2025-12-01T00:00:00Z'
      FROM tenants
      WHERE public_id = '${ROYALTIES_TENANT.publicId}'
      ON CONFLICT (tenant_id) DO UPDATE
      SET close_mode = EXCLUDED.close_mode,
          auto_close_day = EXCLUDED.auto_close_day,
          automatic_since = EXCLUDED.automatic_since;
    `);

    await signIn(page, openMonthPath("2026-02"));

    await expect(page.getByText("Open month: February 2026")).toBeVisible();
    await expect(
      page.getByText("This month closes automatically on Mar 5, 2026.")
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Close month" })).toHaveCount(
      0
    );
  });
});
