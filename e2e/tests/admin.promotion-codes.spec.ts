import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";

import { selectComboboxOption, signInAsAdmin } from "../src/admin";
import { applyScenarioSql } from "../src/db";
import {
  PROMOTION_CODES,
  PROMOTION_CODES_ADMIN,
  PROMOTION_CODES_EDITOR,
  PROMOTION_CODES_EPISODE,
  PROMOTION_CODES_READER,
  PROMOTION_CODES_SCENARIO,
  PROMOTION_CODES_SERIES,
} from "../src/scenarios/promotion-codes";
import { WEB_ADMIN_PROMOTION_CODES_BASE_URL } from "../src/urls";

/**
 * A Tenant admin issuing a promotion code at `/promotion-codes`: creating one
 * on a series, editing its limits, pausing and resuming it, and deleting it,
 * each recorded in the audit log; a second code spelled like one in use being
 * refused on its field; and the redemption of the seeded code, followed to
 * the purchase it discounted. An editor is offered none of it.
 */

const PROMOTION_CODES_PATH = "/promotion-codes";

const adminUrl = (path: string) =>
  new URL(path, WEB_ADMIN_PROMOTION_CODES_BASE_URL).toString();

const signIn = (
  page: Page,
  path = PROMOTION_CODES_PATH,
  credentials: { email: string; password: string } = PROMOTION_CODES_ADMIN
) => signInAsAdmin(page, credentials, path, WEB_ADMIN_PROMOTION_CODES_BASE_URL);

const drawer = (page: Page, name: string) =>
  page.getByRole("dialog", { exact: true, name });

/**
 * The audit log entry of `action` on the code `codeId`. The log is written by
 * an asynchronous recorder, so the read polls.
 */
const expectAuditEntry = async (
  page: Page,
  action: string,
  label: string,
  codeId: string
) => {
  const entry = page.getByRole("row").filter({ hasText: codeId });
  await expect(async () => {
    await page.goto(adminUrl(`/audit-logs?action=${action}`));
    await expect(entry.first()).toBeVisible({ timeout: 5000 });
  }).toPass({ timeout: 30_000 });
  await expect(entry.first()).toContainText(label);
  await expect(entry.first()).toContainText(PROMOTION_CODES_ADMIN.name);
};

test.describe.configure({ mode: "serial" });

test.beforeAll(() => {
  applyScenarioSql(PROMOTION_CODES_SCENARIO);
});

test.afterAll(() => {
  applyScenarioSql(PROMOTION_CODES_SCENARIO);
});

test.describe("Promotion codes", () => {
  test("creates a code, edits its limits, pauses, resumes, and deletes it", async ({
    page,
  }) => {
    await signIn(page);
    await expect(
      page.getByRole("heading", { exact: true, name: "Promotion codes" })
    ).toBeVisible();
    await expect(page.getByRole("table")).toContainText(
      PROMOTION_CODES.welcome.code
    );

    await page
      .getByRole("link", { exact: true, name: "Create promotion code" })
      .click();
    await expect(
      page.getByRole("heading", { name: "Create promotion code" })
    ).toBeVisible();

    // Typed in lower case, which the console stores and shows in capitals.
    await page.getByRole("textbox", { name: /^Code/u }).fill("summer20");
    await page.getByRole("spinbutton", { name: /Percentage/u }).fill("20");
    await page.getByRole("radio", { exact: true, name: "Series" }).click();
    await selectComboboxOption(
      page,
      page.getByRole("combobox", { name: /Series/u }),
      PROMOTION_CODES_SERIES.title
    );
    await page.getByRole("spinbutton", { name: /Per reader/u }).fill("1");
    await page
      .getByRole("button", { exact: true, name: "Create promotion code" })
      .click();

    await expect(page).toHaveURL(/\/promotion-codes\?code=[0-9a-f-]{36}/u);

    const codeId =
      new URL(page.url()).searchParams.get("code") ?? "missing code id";

    const detail = drawer(page, "Promotion code");
    await expect(detail).toContainText("SUMMER20");
    await expect(detail).toContainText("20% off");
    await expect(detail).toContainText(PROMOTION_CODES_SERIES.title);
    await expect(detail).toContainText("Active");

    await detail.getByRole("link", { exact: true, name: "Edit" }).click();
    const edit = drawer(page, "Edit promotion code");
    await edit
      .getByRole("spinbutton", { name: /Total redemptions/u })
      .fill("50");
    await edit.getByRole("button", { exact: true, name: "Save" }).click();
    await expect(detail).toContainText("0 of 50");

    await detail.getByRole("button", { exact: true, name: "Pause" }).click();
    await expect(
      page.getByText("SUMMER20 was paused.", { exact: false })
    ).toBeVisible();
    await expect(detail).toContainText("Paused");

    await detail.getByRole("button", { exact: true, name: "Resume" }).click();
    await expect(page.getByText("SUMMER20 was resumed.")).toBeVisible();
    await expect(detail.getByText("Active", { exact: true })).toBeVisible();

    // The drawer is modal, so the list behind it is read once it is closed.
    // Closing replaces the history entry once the sheet has slid out, so the
    // list is opened again only after that replacement has landed.
    await detail.getByRole("button", { exact: true, name: "Close" }).click();
    await expect(detail).toBeHidden();
    await expect(page).toHaveURL(/\/promotion-codes$/u);
    await expect(page.getByRole("table")).toContainText("SUMMER20");
    await page
      .getByRole("link", { name: "View the promotion code SUMMER20" })
      .click();

    await detail.getByRole("button", { exact: true, name: "Delete" }).click();
    const confirm = page.getByRole("dialog", { name: "Delete SUMMER20?" });
    await expect(confirm).toContainText(
      "The purchases it discounted and its redemptions keep its name."
    );
    await confirm
      .getByRole("button", { exact: true, name: "Delete the code" })
      .click();
    await expect(page).toHaveURL(/\/promotion-codes(?:\?|$)/u);
    await expect(detail).toBeHidden();
    await expect(page.getByRole("table")).not.toContainText("SUMMER20");

    await expectAuditEntry(
      page,
      "promotion_code_created",
      "Promotion code created",
      codeId
    );
    await expectAuditEntry(
      page,
      "promotion_code_updated",
      "Promotion code updated",
      codeId
    );
    await expectAuditEntry(
      page,
      "promotion_code_paused",
      "Promotion code paused",
      codeId
    );
    await expectAuditEntry(
      page,
      "promotion_code_resumed",
      "Promotion code resumed",
      codeId
    );
    await expectAuditEntry(
      page,
      "promotion_code_deleted",
      "Promotion code deleted",
      codeId
    );
  });

  test("refuses a code spelled like one in use on its field", async ({
    page,
  }) => {
    await signIn(page, `${PROMOTION_CODES_PATH}/new`);

    await page
      .getByRole("textbox", { name: /^Code/u })
      .fill(PROMOTION_CODES.welcome.code.toLowerCase());
    await page.getByRole("spinbutton", { name: /Percentage/u }).fill("5");
    await page
      .getByRole("button", { exact: true, name: "Create promotion code" })
      .click();

    await expect(
      page.getByText(
        "Another promotion code is already spelled this way. Choose another code."
      )
    ).toBeVisible();
    await expect(page).toHaveURL(/\/promotion-codes\/new$/u);
  });

  test("lists the purchases a code discounted and opens each one", async ({
    page,
  }) => {
    await signIn(page);

    await page
      .getByRole("link", {
        name: `View the promotion code ${PROMOTION_CODES.welcome.code}`,
      })
      .click();
    const detail = drawer(page, "Promotion code");
    const redemptions = detail.getByRole("table");
    await expect(redemptions).toContainText(PROMOTION_CODES_READER.email);
    await expect(redemptions).toContainText(PROMOTION_CODES_EPISODE.title);
    await expect(redemptions).toContainText("¥500");
    await expect(redemptions).toContainText("¥450");

    await redemptions
      .getByRole("link", {
        name: `Open the purchase of ${PROMOTION_CODES_EPISODE.title}`,
      })
      .click();
    await expect(page).toHaveURL(
      new RegExp(
        `/purchases\\?purchase=${PROMOTION_CODES.welcome.purchaseId}`,
        "u"
      )
    );
    const purchase = drawer(page, "Purchase");
    await expect(purchase).toContainText("Price");
    await expect(purchase).toContainText("¥500");
    await expect(purchase).toContainText("Paid");
    await expect(purchase).toContainText("¥450");
    await expect(purchase).toContainText(PROMOTION_CODES.welcome.code);
  });

  test("offers an editor no promotion codes", async ({ page }) => {
    await signIn(page, "/", PROMOTION_CODES_EDITOR);

    await expect(page.getByRole("navigation").first()).toBeVisible();
    await expect(
      page.getByRole("link", { exact: true, name: "Promotion codes" })
    ).toHaveCount(0);

    await page.goto(adminUrl(PROMOTION_CODES_PATH));
    await expect(
      page.getByRole("heading", { exact: true, name: "Promotion codes" })
    ).toHaveCount(0);
  });
});
