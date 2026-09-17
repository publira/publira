import { expect, test } from "@playwright/test";

import { signInAsSeedAdmin } from "../src/admin";
import { applyScenarioSql } from "../src/db";
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

/**
 * Finding a reader from the console's readers list.
 *
 * The seed tenant's member is the reader looked up. Its administrator holds a
 * staff role on the same tenant, which is what keeps that account off the list.
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
    await expect(page.getByText("admin@example.com")).toHaveCount(0);

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
    await page
      .getByRole("combobox", { name: "Status" })
      .selectOption("suspended");
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
