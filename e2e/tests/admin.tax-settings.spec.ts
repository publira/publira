import { readFile } from "node:fs/promises";

import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";

import { signInAsAdmin } from "../src/admin";
import { applyScenarioSql, querySql } from "../src/db";
import {
  TAX_SETTINGS_ADMIN,
  TAX_SETTINGS_EDITOR,
  TAX_SETTINGS_SALES,
  TAX_SETTINGS_SCENARIO,
  TAX_SETTINGS_TENANT,
} from "../src/scenarios/tax-settings";
import { WEB_ADMIN_TAX_BASE_URL } from "../src/urls";

/**
 * A tenant admin states the tenant's withholding rate and invoice details on
 * Settings, and reads the tax its purchases recorded on Purchases, on Revenue,
 * and on the royalty statement of a month whose rate changed half-way.
 */

const SAVE = "Save the tax and invoice settings";
const SAVED = "The tax and invoice settings were saved.";

const ADMIN_ONLY =
  "Only a tenant administrator can change this setting. You have read-only access.";

const LEGAL_NAME = "Tax Tenant Publishing Inc.";
const REGISTRATION_NUMBER = "T1234567890123";

const adminUrl = (pathname: string): string =>
  new URL(pathname, WEB_ADMIN_TAX_BASE_URL).toString();

const signIn = (
  page: Page,
  nextPath: string,
  account: { email: string; password: string } = TAX_SETTINGS_ADMIN
) => signInAsAdmin(page, account, nextPath, WEB_ADMIN_TAX_BASE_URL);

/** The card's form, which holds its fields, its notices, and its button. */
const card = (page: Page) =>
  page
    .locator("form")
    .filter({ has: page.getByRole("button", { name: SAVE }) });

const field = (page: Page, name: string) =>
  card(page).getByRole("textbox", { exact: true, name });

/** The stored settings, as `withholding|legal name|registration number`. */
const storedSettings = (): string =>
  querySql(`
    SELECT coalesce(c.withholding_rate_bps::text, '') || '|' ||
      coalesce(c.invoice_legal_name, '') || '|' ||
      coalesce(c.invoice_registration_number, '')
    FROM tenant_config c
    WHERE c.tenant_id = '${TAX_SETTINGS_TENANT.id}';
  `);

/** The figure a `<dt>` labels, on a screen of figures. */
const figure = (page: Page, label: string) =>
  page
    .locator("dt")
    .filter({ hasText: new RegExp(`^${label}$`, "u") })
    .locator("xpath=following-sibling::dd[1]");

const drawer = (page: Page) =>
  page.getByRole("dialog", { exact: true, name: "Purchase" });

// The settings and the close are the tenant's, so the tests run in order, each
// from what the one before it saved.
test.describe.configure({ mode: "serial" });

test.beforeAll(() => {
  applyScenarioSql(TAX_SETTINGS_SCENARIO);
});

test.afterAll(() => {
  applyScenarioSql(TAX_SETTINGS_SCENARIO);
});

test.describe("tax and invoices", () => {
  test("an administrator saves the withholding rate and the invoice details, and the save is in Audit logs", async ({
    page,
  }) => {
    await signIn(page, "/settings");

    await expect(field(page, "Tax rate (%)")).toHaveValue("10");
    await expect(card(page)).toContainText(
      `The current rate has applied since ${TAX_SETTINGS_SALES.rateAppliesFrom}.`
    );
    await expect(field(page, "Withholding rate (%)")).toHaveValue("");

    await field(page, "Withholding rate (%)").fill("10.21");
    await field(page, "Legal name").fill(` ${LEGAL_NAME} `);
    await field(page, "Registration number").fill(REGISTRATION_NUMBER);
    await card(page).getByRole("button", { name: SAVE }).click();

    await expect(page.getByText(SAVED)).toBeVisible();
    expect(storedSettings()).toBe(`1021|${LEGAL_NAME}|${REGISTRATION_NUMBER}`);

    await page.reload();

    await expect(field(page, "Withholding rate (%)")).toHaveValue("10.21");
    await expect(field(page, "Legal name")).toHaveValue(LEGAL_NAME);
    await expect(field(page, "Registration number")).toHaveValue(
      REGISTRATION_NUMBER
    );
    // The rate was left as it was, so it still applies from the same moment.
    await expect(card(page)).toContainText(
      `The current rate has applied since ${TAX_SETTINGS_SALES.rateAppliesFrom}.`
    );

    // The entry is written by the audit log's asynchronous recorder, so the
    // read polls.
    const entry = page
      .getByRole("row")
      .filter({ hasText: "Tax and invoices updated" });

    await expect(async () => {
      await page.goto(adminUrl("/audit-logs"));
      await expect(entry.first()).toBeVisible({ timeout: 5000 });
    }).toPass({ timeout: 30_000 });
    await expect(entry.first()).toContainText(TAX_SETTINGS_ADMIN.name);
  });

  test("a registration number with a space is refused on the form", async ({
    page,
  }) => {
    await signIn(page, "/settings");

    await field(page, "Registration number").fill("T123 456");
    await card(page).getByRole("button", { name: SAVE }).click();

    await expect(
      card(page)
        .getByText(
          "The registration number cannot contain spaces or line breaks."
        )
        .first()
    ).toBeVisible();
    await expect(page.getByText(SAVED)).toBeHidden();
    expect(storedSettings()).toBe(`1021|${LEGAL_NAME}|${REGISTRATION_NUMBER}`);
  });

  test("an editor sees the saved settings read-only", async ({ page }) => {
    await signIn(page, "/settings", TAX_SETTINGS_EDITOR);

    await expect(card(page).getByText(ADMIN_ONLY)).toBeVisible();
    await expect(card(page).getByRole("button", { name: SAVE })).toBeDisabled();
    await expect(field(page, "Tax rate (%)")).toBeDisabled();
    await expect(field(page, "Tax rate (%)")).toHaveValue("10");
    await expect(field(page, "Legal name")).toBeDisabled();
    await expect(field(page, "Legal name")).toHaveValue(LEGAL_NAME);
  });

  test("a purchase made after the rate applies shows its tax, and one made before shows none", async ({
    page,
  }) => {
    await signIn(page, "/purchases");

    await expect(page.getByText("Includes ¥100 tax")).toHaveCount(2);

    await page.goto(
      adminUrl(`/purchases?purchase=${TAX_SETTINGS_SALES.taxedPurchaseIds[0]}`)
    );
    await expect(drawer(page)).toContainText("Tax included");
    await expect(drawer(page)).toContainText("¥100 (10%)");

    await page.goto(
      adminUrl(`/purchases?purchase=${TAX_SETTINGS_SALES.untaxedPurchaseId}`)
    );
    await expect(drawer(page)).toContainText(
      TAX_SETTINGS_SALES.untaxedPurchaseId
    );
    await expect(drawer(page)).not.toContainText("Tax included");
  });

  test("Revenue states the tax its net sales include", async ({ page }) => {
    await signIn(page, "/analytics/revenue?from=2026-01-01&to=2026-01-31");

    await expect(figure(page, "Net sales")).toHaveText("¥4,400");
    await expect(figure(page, "Tax")).toHaveText("¥200");
  });

  test("a month whose rate changed closes into a statement with a line per rate, its tax, and each Author's withholding", async ({
    page,
  }) => {
    await signIn(page, `/royalties?period=${TAX_SETTINGS_SALES.period}`);

    await expect(figure(page, "Payout to authors")).toHaveText("¥2,200");
    await expect(figure(page, "Tax in payouts")).toHaveText("¥100");
    // 10.21% of 2,200 less its 100 of tax, rounded down.
    await expect(figure(page, "Withholding")).toHaveText("¥214");

    const lines = page.getByRole("table").last();

    await expect(
      lines.getByRole("columnheader", { name: "Tax rate" })
    ).toBeVisible();
    await expect(
      lines.getByRole("row").filter({ hasText: "10%" })
    ).toContainText("¥100");
    await expect(lines.getByRole("row").filter({ hasText: "—" })).toHaveCount(
      1
    );

    const author = page
      .getByRole("table")
      .first()
      .getByRole("row")
      .filter({ hasText: TAX_SETTINGS_SALES.artist });

    await expect(author).toContainText("¥2,200");
    await expect(author).toContainText("¥214");

    await page.getByRole("button", { name: "Close month" }).click();
    await page
      .getByRole("alertdialog")
      .getByRole("button", { name: "Close month" })
      .click();
    await page.waitForURL(
      (url) =>
        url.pathname === `/royalties/statements/${TAX_SETTINGS_SALES.period}`
    );

    await expect(figure(page, "Tax in payouts")).toHaveText("¥100");
    await expect(figure(page, "Withholding")).toHaveText("¥214");
    await expect(
      page.getByRole("heading", { name: "Payouts by author" })
    ).toBeVisible();

    const downloading = page.waitForEvent("download");
    await page.getByRole("link", { name: "Download CSV" }).click();
    const download = await downloading;
    const csv = await readFile(await download.path(), "utf-8");
    const [header, ...rows] = csv.split("\r\n").filter((row) => row !== "");

    expect(header).toMatch(
      /,source,row_type,tax_rate_percent,tax_amount,withholding_amount$/u
    );
    expect(rows.filter((row) => row.includes(",line,"))).toHaveLength(2);
    expect(rows.filter((row) => row.includes(",10.00,100,"))).toHaveLength(1);

    const subtotals = rows.filter((row) => row.includes(",creator_subtotal,"));

    expect(subtotals).toHaveLength(1);
    expect(subtotals[0]).toMatch(/,100,214$/u);

    await page.goto(adminUrl("/royalties/statements"));

    const statement = page
      .getByRole("row")
      .filter({ hasText: TAX_SETTINGS_SALES.periodLabel });

    await expect(statement).toContainText("¥100");
    await expect(statement).toContainText("¥214");
  });
});
