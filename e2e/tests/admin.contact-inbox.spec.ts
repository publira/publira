import { expect, test } from "@playwright/test";

import { signInAsSeedAdmin } from "../src/admin";
import { applyScenarioSql } from "../src/db";
import {
  CONTACT_INBOX_FROM_GUEST,
  CONTACT_INBOX_FROM_READER,
  CONTACT_INBOX_HANDLED,
  CONTACT_INBOX_SCENARIO,
} from "../src/scenarios/contact-inbox";

/**
 * Reading the messages readers sent the tenant, and marking one dealt with.
 *
 * The messages are seeded rather than sent, so the states and senders the
 * inbox tells apart are the same on every run. Sending one from the public
 * site is `host.contact-form.spec.ts`.
 */
test.describe("web-admin contact inbox", () => {
  test.describe.configure({ mode: "serial" });

  test.beforeAll(() => {
    applyScenarioSql(CONTACT_INBOX_SCENARIO);
  });

  test.afterAll(() => {
    applyScenarioSql(CONTACT_INBOX_SCENARIO);
  });

  test("staff open the inbox from the navigation and filter it by state", async ({
    page,
  }) => {
    await signInAsSeedAdmin(page, "/");

    await page
      .getByRole("link", { exact: true, name: "Contact messages" })
      .click();
    await expect(page).toHaveURL(/\/contact-messages$/u);
    await expect(
      page.getByRole("heading", {
        exact: true,
        level: 1,
        name: "Contact messages",
      })
    ).toBeVisible();

    const fromReader = page.getByRole("row").filter({
      has: page.getByRole("link", {
        exact: true,
        name: CONTACT_INBOX_FROM_READER.subject,
      }),
    });
    await expect(
      fromReader.getByRole("link", {
        name: CONTACT_INBOX_FROM_READER.senderName,
      })
    ).toBeVisible();
    await expect(
      fromReader.getByRole("cell", {
        exact: true,
        name: CONTACT_INBOX_FROM_READER.replyToEmail,
      })
    ).toBeVisible();
    await expect(fromReader.getByText("Waiting")).toBeVisible();

    // A guest's message names nobody, and one with no subject is still opened
    // by its own link.
    const fromGuest = page.getByRole("row").filter({
      has: page.getByRole("cell", {
        exact: true,
        name: CONTACT_INBOX_FROM_GUEST.replyToEmail,
      }),
    });
    await expect(fromGuest.getByText("Guest", { exact: true })).toBeVisible();
    await expect(
      fromGuest.getByRole("link", { exact: true, name: "No subject" })
    ).toBeVisible();

    await page
      .getByRole("combobox", { name: "Status" })
      .selectOption("handled");
    await page.getByRole("button", { name: "Apply" }).click();

    await expect(page).toHaveURL(/[?&]status=handled/u);
    await expect(
      page.getByRole("link", {
        exact: true,
        name: CONTACT_INBOX_HANDLED.subject,
      })
    ).toBeVisible();
    await expect(
      page.getByRole("link", {
        exact: true,
        name: CONTACT_INBOX_FROM_READER.subject,
      })
    ).toHaveCount(0);

    await page.getByRole("link", { name: "Reset" }).click();
    await expect(page).toHaveURL(/\/contact-messages$/u);
  });

  test("staff open a message, see the address to answer at, and mark it handled", async ({
    page,
  }) => {
    await signInAsSeedAdmin(page, "/contact-messages");

    await page
      .getByRole("link", {
        exact: true,
        name: CONTACT_INBOX_FROM_READER.subject,
      })
      .click();

    await expect(page).toHaveURL(
      new RegExp(
        `/contact-messages/${CONTACT_INBOX_FROM_READER.publicId}$`,
        "u"
      )
    );
    await expect(
      page.getByRole("heading", {
        exact: true,
        level: 1,
        name: "Contact message",
      })
    ).toBeVisible();

    const message = page.getByRole("definition");
    await expect(
      message.getByText("The second episode of Seed Series 001 will not open")
    ).toBeVisible();
    await expect(
      message.getByRole("link", {
        name: CONTACT_INBOX_FROM_READER.replyToEmail,
      })
    ).toHaveAttribute(
      "href",
      `mailto:${CONTACT_INBOX_FROM_READER.replyToEmail}`
    );
    await expect(
      message.getByRole("link", { name: CONTACT_INBOX_FROM_READER.senderName })
    ).toBeVisible();
    await expect(message.getByText("Waiting")).toBeVisible();

    await page
      .getByRole("button", { exact: true, name: "Mark handled" })
      .click();

    await expect(
      page.getByText("The message has been marked handled.")
    ).toBeVisible();
    await expect(message.getByText("Handled")).toBeVisible();
    await expect(
      page.getByRole("button", { exact: true, name: "Mark handled" })
    ).toHaveCount(0);

    await page
      .getByRole("button", { exact: true, name: "Mark as waiting" })
      .click();

    await expect(message.getByText("Waiting")).toBeVisible();
    await expect(
      page.getByRole("button", { exact: true, name: "Mark handled" })
    ).toBeVisible();
  });
});
