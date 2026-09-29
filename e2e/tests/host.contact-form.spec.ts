import { expect, test } from "@playwright/test";

import { signInAsSeedAdmin } from "../src/admin";
import { applyScenarioSql } from "../src/db";
import { signInAsMember } from "../src/host";
import {
  CONTACT_FORM_GUEST_EMAIL,
  CONTACT_FORM_MEMBER,
  CONTACT_FORM_SCENARIO,
} from "../src/scenarios/contact-form";
import { hostPath, WEB_HOST_BASE_URL } from "../src/urls";

/**
 * A reader told to get in touch reaches the contact form from where they were
 * told, and the tenant's staff find what they sent in the console.
 */
test.describe("web-host contact form", () => {
  test.describe.configure({ mode: "serial" });

  test.beforeAll(() => {
    applyScenarioSql(CONTACT_FORM_SCENARIO);
  });

  test.afterAll(() => {
    applyScenarioSql(CONTACT_FORM_SCENARIO);
  });

  test("a reader follows the date of birth copy on the settings screen and sends a message", async ({
    page,
  }) => {
    const subject = "My date of birth is wrong";
    await signInAsMember(page, CONTACT_FORM_MEMBER, "/settings");

    await page
      .getByRole("link", { name: "Contact this site if it is wrong." })
      .click();

    await expect(page).toHaveURL(/\/contact$/u);
    await expect(
      page.getByRole("heading", { exact: true, level: 1, name: "Contact" })
    ).toBeVisible();
    await expect(page.getByLabel("Your email address")).toHaveValue(
      CONTACT_FORM_MEMBER.email
    );

    await page.getByLabel("Subject (optional)").fill(subject);
    await page
      .getByLabel("Message")
      .fill("The date of birth on my account is a year off.");
    await page.getByRole("button", { exact: true, name: "Send" }).click();

    await expect(page).toHaveURL(/\/contact\/sent$/u);
    await expect(
      page.getByRole("heading", {
        level: 1,
        name: "Your message has been sent",
      })
    ).toBeVisible();

    await signInAsSeedAdmin(page, "/contact-messages");
    const row = page.getByRole("row").filter({
      has: page.getByRole("link", { exact: true, name: subject }),
    });
    await expect(
      row.getByRole("link", { name: CONTACT_FORM_MEMBER.name })
    ).toBeVisible();
    await expect(
      row.getByRole("cell", { exact: true, name: CONTACT_FORM_MEMBER.email })
    ).toBeVisible();
  });

  test("a guest reaches the form from the footer and keeps what they wrote when it is refused", async ({
    page,
  }) => {
    const subject = "A question about the app";
    await page.goto(`${WEB_HOST_BASE_URL}${hostPath("/")}`);

    await page
      .getByRole("contentinfo")
      .getByRole("link", { exact: true, name: "Contact" })
      .click();

    await expect(page).toHaveURL(/\/contact$/u);
    const email = page.getByLabel("Your email address");
    const message = page.getByRole("textbox", { name: /^Message/u });
    await expect(email).toHaveValue("");

    const tooLong = "a".repeat(4001);
    await email.fill(CONTACT_FORM_GUEST_EMAIL);
    await page.getByLabel("Subject (optional)").fill(subject);
    await message.fill(tooLong);
    await page.getByRole("button", { exact: true, name: "Send" }).click();

    await expect(
      page.getByText("Keep the message to 4000 characters or fewer.")
    ).toBeVisible();
    await expect(email).toHaveValue(CONTACT_FORM_GUEST_EMAIL);
    await expect(page.getByLabel("Subject (optional)")).toHaveValue(subject);
    await expect(message).toHaveValue(tooLong);

    await message.fill("Do you have an app for phones?");
    await page.getByRole("button", { exact: true, name: "Send" }).click();

    await expect(page).toHaveURL(/\/contact\/sent$/u);

    await signInAsSeedAdmin(page, "/contact-messages");
    const row = page.getByRole("row").filter({
      has: page.getByRole("link", { exact: true, name: subject }),
    });
    await expect(row.getByText("Guest", { exact: true })).toBeVisible();
    await expect(
      row.getByRole("cell", { exact: true, name: CONTACT_FORM_GUEST_EMAIL })
    ).toBeVisible();
  });
});
