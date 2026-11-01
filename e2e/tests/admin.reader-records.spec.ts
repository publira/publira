import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";

import { selectComboboxOption, signInAsSeedAdmin } from "../src/admin";
import { applyScenarioSql } from "../src/db";
import {
  READER_RECORDS_BUYER,
  READER_RECORDS_EMPTY,
  READER_RECORDS_PURCHASE,
  READER_RECORDS_SCENARIO,
  READER_RECORDS_TICKET,
} from "../src/scenarios/reader-records";

/** The episode the suite issues a ticket for, which the buyer holds none of. */
const ISSUED_EPISODE = {
  label: "Seed Episode 001-01 (SeedEPSDAAA1)",
  note: "Reader records E2E: issued from the reader page",
  seriesLabel: "Seed Series 001 (SeedSERSAAA1)",
  title: "Seed Episode 001-01",
} as const;

/** One section of the reader page, found by its heading. */
const section = (page: Page, title: string) =>
  page.locator("section").filter({
    has: page.getByRole("heading", { exact: true, level: 2, name: title }),
  });

const sectionRows = (page: Page, title: string) =>
  section(page, title).getByRole("row");

/**
 * A reader's purchases and access tickets on their page in the console, and
 * the ticket actions a support case needs, taken from that page rather than
 * from the ticket screen.
 */
test.describe.configure({ mode: "serial" });

test.beforeAll(() => {
  applyScenarioSql(READER_RECORDS_SCENARIO);
});

test.afterAll(() => {
  applyScenarioSql(READER_RECORDS_SCENARIO);
});

test.describe("web-admin reader purchases and tickets", () => {
  test("lists the reader's purchase and ticket with their state and episode", async ({
    page,
  }) => {
    const prefetched: URL[] = [];
    page.on("request", (request) => {
      if (request.headers()["next-router-prefetch"]) {
        prefetched.push(new URL(request.url()));
      }
    });

    await signInAsSeedAdmin(page, `/readers/${READER_RECORDS_BUYER.publicId}`);

    const purchase = sectionRows(page, "Purchases").filter({
      hasText: READER_RECORDS_PURCHASE.episodeTitle,
    });

    await expect(purchase).toHaveCount(1);
    await expect(purchase.getByText("Active")).toBeVisible();
    await expect(
      purchase.getByRole("link", {
        exact: true,
        name: READER_RECORDS_PURCHASE.episodeTitle,
      })
    ).toHaveAttribute(
      "href",
      /\/series\/SeedSERSAAA1\/episodes\/SeedEPSDAA1A$/u
    );
    await expect(
      purchase.getByRole("link", {
        name: `View the purchase of ${READER_RECORDS_PURCHASE.episodeTitle}`,
      })
    ).toHaveAttribute(
      "href",
      new RegExp(`/purchases\\?purchase=${READER_RECORDS_PURCHASE.id}$`, "u")
    );

    const ticket = sectionRows(page, "Access tickets").filter({
      hasText: READER_RECORDS_TICKET.note,
    });

    await expect(ticket).toHaveCount(1);
    await expect(ticket.getByText("Active")).toBeVisible();
    await expect(
      ticket.getByRole("link", {
        exact: true,
        name: READER_RECORDS_TICKET.episodeTitle,
      })
    ).toHaveAttribute(
      "href",
      /\/series\/SeedSERSAAA1\/episodes\/SeedEPSDAAA2$/u
    );

    // The back link is still prefetched, which is what tells a quiet sidebar
    // from a page that prefetches nothing.
    await expect
      .poll(() => prefetched.some(({ pathname }) => pathname === "/readers"))
      .toBe(true);
    // An absence no web-first assertion can wait for, so the wait is for the
    // network to have gone quiet.
    // oxlint-disable-next-line sonarjs/no-networkidle-wait
    await page.waitForLoadState("networkidle");

    const prefetchedPaths = prefetched.map(({ pathname }) => pathname);

    expect(prefetchedPaths).not.toContain("/calendar");
    expect(prefetchedPaths).not.toContain("/analytics/audience");
    expect(prefetchedPaths).not.toContain("/analytics/episodes");
  });

  test("revoking a ticket from the reader page updates its row", async ({
    page,
  }) => {
    await signInAsSeedAdmin(page, `/readers/${READER_RECORDS_BUYER.publicId}`);

    const ticket = sectionRows(page, "Access tickets").filter({
      hasText: READER_RECORDS_TICKET.note,
    });

    await ticket.getByRole("button", { name: "Revoke" }).click();
    // The confirmation carries the same label as the trigger that opened it,
    // so the dialog is what tells the two apart.
    await page
      .getByRole("alertdialog")
      .getByRole("button", { exact: true, name: "Revoke" })
      .click();

    await expect(page.getByText("The ticket was revoked.")).toBeVisible();
    await expect(ticket.getByText("Revoked", { exact: true })).toBeVisible();
    await expect(ticket.getByRole("button", { name: "Revoke" })).toHaveCount(0);
    await expect(page).toHaveURL(
      new RegExp(`/readers/${READER_RECORDS_BUYER.publicId}$`, "u")
    );
  });

  test("issuing a ticket from the reader page adds it to the page's list", async ({
    page,
  }) => {
    await signInAsSeedAdmin(page, `/readers/${READER_RECORDS_BUYER.publicId}`);

    await section(page, "Access tickets")
      .getByRole("button", { name: "Issue a ticket" })
      .click();

    const dialog = page.getByRole("dialog", {
      name: `Issue a ticket to ${READER_RECORDS_BUYER.name}`,
    });

    await expect(dialog).toBeVisible();
    // The page already names the reader, so the form asks only for the rest.
    await expect(dialog.getByRole("combobox", { name: /Reader/u })).toHaveCount(
      0
    );

    await selectComboboxOption(
      page,
      dialog.getByRole("combobox", { name: /Series/u }),
      ISSUED_EPISODE.seriesLabel
    );
    await selectComboboxOption(
      page,
      dialog.getByRole("combobox", { name: /Episode/u }),
      ISSUED_EPISODE.label
    );
    await dialog
      .getByRole("textbox", { name: /Note/u })
      .fill(ISSUED_EPISODE.note);
    await dialog.getByRole("button", { name: "Issue the ticket" }).click();

    await expect(page.getByText("The ticket was issued.")).toBeVisible();
    await expect(dialog).toHaveCount(0);
    await expect(page).toHaveURL(
      new RegExp(`/readers/${READER_RECORDS_BUYER.publicId}$`, "u")
    );

    const issued = sectionRows(page, "Access tickets").filter({
      hasText: ISSUED_EPISODE.note,
    });

    await expect(issued.getByText("Active")).toBeVisible();
    await expect(
      issued.getByRole("link", { exact: true, name: ISSUED_EPISODE.title })
    ).toBeVisible();
  });

  test("a reader with neither sees both sections empty", async ({ page }) => {
    await signInAsSeedAdmin(page, `/readers/${READER_RECORDS_EMPTY.publicId}`);

    await expect(
      section(page, "Purchases").getByText(
        "This reader has not bought anything."
      )
    ).toBeVisible();
    await expect(
      section(page, "Access tickets").getByText(
        "This reader holds no access tickets."
      )
    ).toBeVisible();
    await expect(section(page, "Purchases").getByRole("table")).toHaveCount(0);
    await expect(
      section(page, "Access tickets").getByRole("table")
    ).toHaveCount(0);
  });
});
