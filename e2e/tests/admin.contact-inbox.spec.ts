import { expect, test } from "@playwright/test";

import { selectOption, signInAsSeedAdmin } from "../src/admin";
import { applyScenarioSql } from "../src/db";
import { clearMessagesTo, waitForMessageTo } from "../src/mail";
import { SEED_ADMIN } from "../src/scenarios/admin-publish";
import {
  CONTACT_INBOX_FROM_GUEST,
  CONTACT_INBOX_FROM_READER,
  CONTACT_INBOX_HANDLED,
  CONTACT_INBOX_SCENARIO,
} from "../src/scenarios/contact-inbox";

/**
 * Reading the messages readers sent the tenant, marking one dealt with, and
 * answering one from its page.
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
    await expect(fromReader.getByText("Unhandled")).toBeVisible();

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

    await selectOption(
      page,
      page.getByRole("combobox", { name: "Status" }),
      "Handled"
    );
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
    await expect(message.getByText("Unhandled")).toBeVisible();

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

    await page.getByRole("button", { exact: true, name: "Reopen" }).click();

    await expect(message.getByText("Unhandled")).toBeVisible();
    await expect(
      page.getByRole("button", { exact: true, name: "Mark handled" })
    ).toBeVisible();
  });

  test("staff read the exchange under a message, each reply named by the address it came from", async ({
    page,
  }) => {
    await signInAsSeedAdmin(
      page,
      `/contact-messages/${CONTACT_INBOX_HANDLED.publicId}`
    );

    const exchange = page.getByRole("list").filter({
      has: page.getByText(`Reply from ${CONTACT_INBOX_HANDLED.replyFromEmail}`),
    });
    await expect(exchange.getByRole("listitem")).toHaveText([
      new RegExp(
        `^Answer from ${SEED_ADMIN.name}.*${CONTACT_INBOX_HANDLED.answer}$`,
        "u"
      ),
      new RegExp(
        `^Reply from ${CONTACT_INBOX_HANDLED.replyFromEmail}.*${CONTACT_INBOX_HANDLED.reply}$`,
        "u"
      ),
    ]);
  });

  test("staff answer a message from its page, see it under the message handled, and the reader is mailed it", async ({
    page,
  }) => {
    const answer =
      "We do: search for Publira Reader in your phone's app store.";
    await clearMessagesTo(CONTACT_INBOX_FROM_GUEST.replyToEmail);
    await signInAsSeedAdmin(
      page,
      `/contact-messages/${CONTACT_INBOX_FROM_GUEST.publicId}`
    );

    const message = page.getByRole("definition");
    await expect(message.getByText("Unhandled")).toBeVisible();
    await expect(
      page.getByText("Nobody has answered this message yet.")
    ).toBeVisible();
    // The page says where the answer goes and where the reply comes back.
    await expect(
      page.getByText(
        `The answer is mailed to ${CONTACT_INBOX_FROM_GUEST.replyToEmail} and marks the message handled. When the reader writes back, the reply reaches your own account's email address.`,
        { exact: false }
      )
    ).toBeVisible();

    const field = page.getByRole("textbox", { name: "Answer" });
    await field.fill(answer);
    await page
      .getByRole("button", { exact: true, name: "Send answer" })
      .click();

    await expect(
      page.getByText(
        "The answer has been saved and will be mailed to the reader."
      )
    ).toBeVisible();
    const entry = page
      .getByRole("listitem")
      .filter({ hasText: `Answer from ${SEED_ADMIN.name}` });
    await expect(entry).toContainText(answer);
    await expect(message.getByText("Handled", { exact: true })).toBeVisible();
    await expect(
      page.getByText("Nobody has answered this message yet.")
    ).toHaveCount(0);
    await expect(field).toHaveValue("");

    const mail = await waitForMessageTo(CONTACT_INBOX_FROM_GUEST.replyToEmail);
    expect(mail.subject).toMatch(/^Re: /u);
    expect(mail.text).toContain(answer);

    // The inbox marks the message answered.
    await page
      .getByRole("link", { exact: true, name: "Back to contact messages" })
      .first()
      .click();
    await expect(page).toHaveURL(/\/contact-messages$/u);
    const answered = page.getByRole("row").filter({
      has: page.getByRole("cell", {
        exact: true,
        name: CONTACT_INBOX_FROM_GUEST.replyToEmail,
      }),
    });
    await expect(answered.getByText("Answered")).toBeVisible();
  });
});
