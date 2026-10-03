import { expect, test } from "@playwright/test";

import { selectOption, signInAsSeedAdmin } from "../src/admin";
import { applyScenarioSql } from "../src/db";
import { SEED_ADMIN } from "../src/scenarios/admin-publish";
import {
  READER_MODERATION_DELETE,
  READER_MODERATION_SCENARIO,
  READER_MODERATION_SUSPEND,
} from "../src/scenarios/reader-moderation";

const SEED_READER = {
  email: "member@example.com",
  name: "Sample Member",
  publicId: "SeedMMBRAAA1",
} as const;

/** The seed tenant administrator every test here signs in as. */
const SEED_ADMIN_PUBLIC_ID = "SeedADMNAAA1";

const OWN_ACCOUNT_REASON =
  "This is the account you are signed in with, so it cannot be suspended or deleted here.";

/**
 * Finding a reader from the console's readers list.
 *
 * The seed tenant's member is the reader looked up. The list holds every
 * account of the tenant, its administrator included, so the member is found by
 * searching rather than by scanning the first page.
 */
test.describe("web-admin readers", () => {
  test("staff open the list from the navigation, search by email, and filter by status", async ({
    page,
  }) => {
    await signInAsSeedAdmin(page, "/");

    await page.getByRole("link", { exact: true, name: "Readers" }).click();
    await expect(page).toHaveURL(/\/readers$/u);
    await expect(
      page.getByRole("heading", { level: 1, name: "Readers" })
    ).toBeVisible();

    await page
      .getByRole("searchbox", { name: "Name or email" })
      .fill(SEED_READER.email);
    await page.getByRole("button", { name: "Apply" }).click();

    await expect(page).toHaveURL(/[?&]q=member%40example\.com/u);
    // The search is a substring match, and the scenario accounts other specs
    // add to this tenant (`settings-member@example.com` and the like) match it
    // too, so the row is picked by an exact email cell.
    const row = page.getByRole("row").filter({
      has: page.getByRole("cell", { exact: true, name: SEED_READER.email }),
    });
    await expect(row).toHaveCount(1);
    await expect(row.getByText("Active")).toBeVisible();
    await expect(
      row.getByRole("link", { name: SEED_READER.name })
    ).toHaveAttribute(
      "href",
      new RegExp(`/readers/${SEED_READER.publicId}$`, "u")
    );

    // The search box keeps what was typed, so narrowing by state keeps it too.
    await selectOption(
      page,
      page.getByRole("combobox", { name: "Status" }),
      "Suspended"
    );
    await page.getByRole("button", { name: "Apply" }).click();

    await expect(page).toHaveURL(/[?&]status=suspended/u);
    await expect(page.getByText("There are no readers to show.")).toBeVisible();
    await expect(
      page.getByRole("searchbox", { name: "Name or email" })
    ).toHaveValue(SEED_READER.email);

    await page.getByRole("link", { name: "Reset" }).click();
    await expect(page).toHaveURL(/\/readers$/u);
    await expect(
      page.getByRole("searchbox", { name: "Name or email" })
    ).toHaveValue("");
  });

  test("staff open a reader from the list and see the account", async ({
    page,
  }) => {
    await signInAsSeedAdmin(page, `/readers?q=${SEED_READER.email}`);

    await page
      .getByRole("row")
      .filter({
        has: page.getByRole("cell", { exact: true, name: SEED_READER.email }),
      })
      .getByRole("link", { name: SEED_READER.name })
      .click();

    await expect(page).toHaveURL(
      new RegExp(`/readers/${SEED_READER.publicId}$`, "u")
    );
    await expect(
      page.getByRole("heading", { level: 1, name: "Reader" })
    ).toBeVisible();
    const account = page.getByRole("definition");
    await expect(account.getByText(SEED_READER.name)).toBeVisible();
    await expect(account.getByText(SEED_READER.email)).toBeVisible();
    await expect(account.getByText(SEED_READER.publicId)).toBeVisible();
    await expect(account.getByText("Active")).toBeVisible();
    await expect(
      page.getByRole("heading", { exact: true, level: 2, name: "Comments" })
    ).toBeVisible();
  });

  test("the list badges the administrator with their role and a reader with none", async ({
    page,
  }) => {
    await signInAsSeedAdmin(page, `/readers?q=${SEED_ADMIN.email}`);

    // Other specs add accounts whose address ends in the same text, so the
    // row is picked by an exact email cell.
    const adminRow = page.getByRole("row").filter({
      has: page.getByRole("cell", { exact: true, name: SEED_ADMIN.email }),
    });
    await expect(adminRow).toHaveCount(1);
    await expect(
      adminRow.getByText("Tenant admin", { exact: true })
    ).toBeVisible();

    await page
      .getByRole("searchbox", { name: "Name or email" })
      .fill(SEED_READER.email);
    await page.getByRole("button", { name: "Apply" }).click();
    await expect(page).toHaveURL(/[?&]q=member%40example\.com/u);
    const readerRow = page.getByRole("row").filter({
      has: page.getByRole("cell", { exact: true, name: SEED_READER.email }),
    });
    await expect(readerRow).toHaveCount(1);
    await expect(readerRow.getByText("Active")).toBeVisible();
    await expect(
      readerRow.getByText("Tenant admin", { exact: true })
    ).toHaveCount(0);
  });

  test("a member opens their reader page from the members screen, which withholds suspend and delete on their own account", async ({
    page,
  }) => {
    await signInAsSeedAdmin(page, "/members");

    await page
      .getByRole("row")
      .filter({
        has: page.getByRole("cell", { exact: true, name: SEED_ADMIN.email }),
      })
      .getByRole("link", { name: SEED_ADMIN.name })
      .click();

    await expect(page).toHaveURL(
      new RegExp(`/readers/${SEED_ADMIN_PUBLIC_ID}$`, "u")
    );
    const account = page.getByRole("definition");
    // The seed administrator is named "Tenant Admin", so only an exact match
    // tells the badge from the name.
    await expect(
      account.getByText("Tenant admin", { exact: true })
    ).toBeVisible();
    await expect(page.getByText(OWN_ACCOUNT_REASON)).toBeVisible();
    await expect(
      page.getByRole("button", { exact: true, name: "Suspend" })
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { exact: true, name: "Delete" })
    ).toHaveCount(0);
  });

  test.describe("moderation", () => {
    test.describe.configure({ mode: "serial" });

    test.beforeAll(() => {
      applyScenarioSql(READER_MODERATION_SCENARIO);
    });

    test.afterAll(() => {
      applyScenarioSql(READER_MODERATION_SCENARIO);
    });

    test("staff suspend a reader and lift the suspension from the detail page", async ({
      page,
    }) => {
      await signInAsSeedAdmin(
        page,
        `/readers/${READER_MODERATION_SUSPEND.publicId}`
      );
      const account = page.getByRole("definition");
      await expect(account.getByText("Active")).toBeVisible();

      await page.getByRole("button", { exact: true, name: "Suspend" }).click();
      const dialog = page.getByRole("alertdialog");
      await expect(dialog).toContainText(
        `Suspend ${READER_MODERATION_SUSPEND.name}?`
      );
      await dialog
        .getByRole("button", { exact: true, name: "Suspend" })
        .click();

      await expect(account.getByText("Suspended")).toBeVisible();
      await expect(
        page.getByRole("button", { exact: true, name: "Suspend" })
      ).toHaveCount(0);

      await page
        .getByRole("button", { exact: true, name: "Lift suspension" })
        .click();

      await expect(account.getByText("Active")).toBeVisible();
      await expect(
        page.getByRole("button", { exact: true, name: "Suspend" })
      ).toBeVisible();
    });

    test("staff delete a reader after a confirmation that names them", async ({
      page,
    }) => {
      await signInAsSeedAdmin(
        page,
        `/readers/${READER_MODERATION_DELETE.publicId}`
      );

      await page.getByRole("button", { exact: true, name: "Delete" }).click();
      const dialog = page.getByRole("alertdialog");
      await expect(dialog).toContainText(
        `Delete ${READER_MODERATION_DELETE.name}?`
      );
      await dialog.getByRole("button", { exact: true, name: "Delete" }).click();

      await expect(page).toHaveURL(/\/readers$/u);
      await expect(
        page.getByText("The reader has been deleted.")
      ).toBeVisible();

      await page
        .getByRole("searchbox", { name: "Name or email" })
        .fill(READER_MODERATION_DELETE.email);
      await page.getByRole("button", { name: "Apply" }).click();
      await expect(page).toHaveURL(/[?&]q=/u);
      await expect(
        page.getByText("There are no readers to show.")
      ).toBeVisible();
    });
  });
});
