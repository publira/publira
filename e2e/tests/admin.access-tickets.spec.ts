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
 * Admin access-ticket issue / list / revoke (#615).
 *
 * Server APIs already exist (#614). This covers the console: pick a series
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
      page.getByRole("heading", { name: "アクセスチケット" })
    ).toBeVisible();
    await expect(page.getByText("SeedTCKTAAA1")).toBeVisible();
    await expect(
      page
        .getByRole("row")
        .filter({ hasText: "SeedTCKTAAA1" })
        .getByText("有効")
    ).toBeVisible();

    const note = `e2e access ticket ${uniqueSuffix()}`;
    notes.push(note);

    await page.getByRole("link", { name: "チケットを発行" }).click();
    await expect(
      page.getByRole("heading", { name: "チケットを発行" })
    ).toBeVisible();

    await page
      .getByRole("textbox", { name: /ユーザー public_id/u })
      .fill(SEED_TICKET.memberPublicId);
    await selectComboboxOption(
      page,
      page.getByRole("combobox", { name: /シリーズ/u }),
      SEED_TICKET.seriesLabel
    );
    await selectComboboxOption(
      page,
      page.getByRole("combobox", { name: /エピソード/u }),
      `${SEED_TICKET.episodeTitle} (${SEED_TICKET.episodePublicId})`
    );
    await page.getByRole("textbox", { name: /メモ/u }).fill(note);
    await page.getByRole("button", { name: "チケットを発行" }).click();

    await expect(page).toHaveURL(/\/access-tickets(?:\?[^/]*)?$/u);
    await expect(page.getByText("チケットを発行しました。")).toBeVisible();
    await expect(page.getByText(note)).toBeVisible();

    const issuedRow = page.getByRole("row").filter({ hasText: note });
    await expect(issuedRow.getByText("有効")).toBeVisible();
    await issuedRow.getByRole("button", { name: "失効" }).click();
    await page.getByRole("button", { name: "失効する" }).click();

    await expect(issuedRow.getByText("失効")).toBeVisible();
    await expect(issuedRow.getByRole("button", { name: "失効" })).toHaveCount(
      0
    );
  });
});
