import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";

import { signInAsAdmin } from "../src/admin";
import { applyScenarioSql, runSql } from "../src/db";
import {
  ROYALTIES_ADMIN,
  ROYALTIES_SALES,
  ROYALTIES_SCENARIO,
  ROYALTIES_TENANT,
} from "../src/scenarios/royalties";
import { WEB_ADMIN_ROYALTIES_BASE_URL } from "../src/urls";

/**
 * A publisher reviewing a month of creator royalties and closing it into a
 * statement, and a publisher whose months close on their own.
 */

const openMonthPath = (period: string): string => `/royalties?period=${period}`;

const signIn = (page: Page, nextPath: string): Promise<void> =>
  signInAsAdmin(page, ROYALTIES_ADMIN, nextPath, WEB_ADMIN_ROYALTIES_BASE_URL);

/** Every body row of the lines table, author headings and subtotals included. */
const lineRows = (page: Page): Promise<string[]> =>
  page.getByRole("table").locator("tbody tr").allInnerTexts();

test.beforeAll(() => {
  applyScenarioSql(ROYALTIES_SCENARIO);
});

test.afterAll(() => {
  applyScenarioSql(ROYALTIES_SCENARIO);
});

test.describe("royalties", () => {
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

    await page.goto(
      `${WEB_ADMIN_ROYALTIES_BASE_URL}${openMonthPath(ROYALTIES_SALES.period)}`
    );
    await expect(
      page.getByText("This month cannot be previewed")
    ).toBeVisible();

    await page.getByRole("link", { name: "Closed statements" }).first().click();
    await expect(
      page.getByRole("link", { name: ROYALTIES_SALES.periodLabel })
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
