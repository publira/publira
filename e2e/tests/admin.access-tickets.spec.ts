import { expect, test } from "@playwright/test";

import { selectComboboxOption, signInAsSeedAdmin } from "../src/admin";
import { runSql } from "../src/db";
import { uniqueSuffix } from "../src/scenarios/admin-publish";

const SEED_TICKET = {
  episodePublicId: "SeedEPSDAAA1",
  episodeTitle: "Seed Episode 001-01",
  memberPublicId: "SeedMMBRAAA1",
  seriesLabel: "Seed Series 001 (SeedSERSAAA1)",
} as const;

/**
 * Admin access-ticket issue / list / revoke.
 *
 * The server APIs already exist. This covers the console: pick a series
 * and episode, issue a grant, see status on the list, and revoke it.
 */
test.describe("web-admin access tickets", () => {
  const notes: string[] = [];

  test.afterEach(() => {
    if (notes.length === 0) {
      return;
    }

    const literals = notes.map((note) => `'${note.replaceAll("'", "''")}'`);
    runSql(`
      DELETE FROM access_tickets
      WHERE note IN (${literals.join(", ")})
        AND public_id <> 'SeedTCKTAAA1';
    `);
    notes.length = 0;
  });

  test("the list shows ticket state, and a ticket can be issued and revoked", async ({
    page,
  }) => {
    await signInAsSeedAdmin(page, "/access-tickets");

    await expect(
      page.getByRole("heading", { name: "Access tickets" })
    ).toBeVisible();
    await expect(page.getByText("SeedTCKTAAA1")).toBeVisible();
    await expect(
      page
        .getByRole("row")
        .filter({ hasText: "SeedTCKTAAA1" })
        .getByText("Active")
    ).toBeVisible();

    const note = `e2e access ticket ${uniqueSuffix()}`;
    notes.push(note);

    await page.getByRole("link", { name: "Issue a ticket" }).click();
    await expect(
      page.getByRole("heading", { name: "Issue a ticket" })
    ).toBeVisible();

    await page
      .getByRole("textbox", { name: /User public_id/u })
      .fill(SEED_TICKET.memberPublicId);
    await selectComboboxOption(
      page,
      page.getByRole("combobox", { name: /Series/u }),
      SEED_TICKET.seriesLabel
    );
    await selectComboboxOption(
      page,
      page.getByRole("combobox", { name: /Episode/u }),
      `${SEED_TICKET.episodeTitle} (${SEED_TICKET.episodePublicId})`
    );
    await page.getByRole("textbox", { name: /Note/u }).fill(note);
    await page.getByRole("button", { name: "Issue the ticket" }).click();

    await expect(page).toHaveURL(/\/access-tickets(?:\?[^/]*)?$/u);
    await expect(page.getByText("The ticket was issued.")).toBeVisible();
    await expect(page.getByText(note)).toBeVisible();

    const issuedRow = page.getByRole("row").filter({ hasText: note });
    await expect(issuedRow.getByText("Active")).toBeVisible();
    await issuedRow.getByRole("button", { name: "Revoke" }).click();
    // The confirmation carries the same label as the trigger that opened it,
    // so the dialog is what tells the two apart.
    await page
      .getByRole("alertdialog")
      .getByRole("button", { exact: true, name: "Revoke" })
      .click();

    await expect(issuedRow.getByText("Revoked", { exact: true })).toBeVisible();
    await expect(issuedRow.getByRole("button", { name: "Revoke" })).toHaveCount(
      0
    );
  });
});
