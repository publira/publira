import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";

import { selectComboboxOption, signInAsSeedAdmin } from "../src/admin";
import { runSql } from "../src/db";
import { uniqueSuffix } from "../src/scenarios/admin-publish";

const SEED_TICKET = {
  episodePublicId: "SeedEPSDAAA1",
  episodeTitle: "Seed Episode 001-01",
  memberEmail: "member@example.com",
  memberLabel: "Sample Member (member@example.com)",
  seriesLabel: "Seed Series 001 (SeedSERSAAA1)",
} as const;

/** The pair `SeedTCKTAAA1` already opens: the member and `Seed Episode 001-10`. */
const SEED_TICKETED_EPISODE = {
  episodePublicId: "SeedEPSDAA1A",
  episodeTitle: "Seed Episode 001-10",
  ticketPublicId: "SeedTCKTAAA1",
} as const;

/** Fills the Issue a ticket form for the seed member and submits it. */
const issueTicketForMember = async (
  page: Page,
  episode: { episodePublicId: string; episodeTitle: string },
  note: string
) => {
  await page.getByRole("link", { name: "Issue a ticket" }).click();
  await expect(
    page.getByRole("heading", { name: "Issue a ticket" })
  ).toBeVisible();

  // The reader picker searches the tenant's readers with what is typed, so
  // it is filled with a query rather than the option's full label.
  const readerCombobox = page.getByRole("combobox", { name: /Reader/u });
  await readerCombobox.click();
  await readerCombobox.fill(SEED_TICKET.memberEmail);
  await page.getByRole("option", { name: SEED_TICKET.memberLabel }).click();
  await selectComboboxOption(
    page,
    page.getByRole("combobox", { name: /Series/u }),
    SEED_TICKET.seriesLabel
  );
  await selectComboboxOption(
    page,
    page.getByRole("combobox", { name: /Episode/u }),
    `${episode.episodeTitle} (${episode.episodePublicId})`
  );
  await page.getByRole("textbox", { name: /Note/u }).fill(note);
  await page.getByRole("button", { name: "Issue the ticket" }).click();
};

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

    await issueTicketForMember(page, SEED_TICKET, note);

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

  test("issuing a ticket the pair already has names the active one instead of issuing", async ({
    page,
  }) => {
    await signInAsSeedAdmin(page, "/access-tickets");

    const note = `e2e duplicate access ticket ${uniqueSuffix()}`;
    notes.push(note);

    await issueTicketForMember(page, SEED_TICKETED_EPISODE, note);

    await expect(
      page.getByText(
        `The same user and episode already have an active ticket (${SEED_TICKETED_EPISODE.ticketPublicId}).`,
        { exact: false }
      )
    ).toBeVisible();
    await expect(page).toHaveURL(/\/access-tickets\/new(?:\?[^/]*)?$/u);
    await expect(page.getByText("The ticket was issued.")).toHaveCount(0);
  });
});
