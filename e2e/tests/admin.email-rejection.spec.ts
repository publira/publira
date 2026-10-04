import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";

import { signInAsAdmin } from "../src/admin";
import { applyScenarioSql, querySql } from "../src/db";
import {
  EMAIL_REJECTION_ADMIN,
  EMAIL_REJECTION_EDITOR,
  EMAIL_REJECTION_READER,
  EMAIL_REJECTION_SCENARIO,
  EMAIL_REJECTION_TENANT,
} from "../src/scenarios/email-rejection";
import { disposableEmailDomains } from "../src/sign-in-provider";
import {
  hostPath,
  WEB_ADMIN_EMAIL_REJECTION_BASE_URL,
  WEB_HOST_EMAIL_REJECTION_BASE_URL,
} from "../src/urls";

/**
 * A tenant administrator decides from `/settings` which addresses readers
 * cannot sign up with, and the storefront's sign-up form is where that is
 * measured. The disposable-domain list is the one the stack names in the
 * platform policy, served by the sign-in-provider stand-in, so switching it on
 * is what turns a sign-up the stack accepted into one it refuses.
 */

const signupUrl = `${WEB_HOST_EMAIL_REJECTION_BASE_URL}${hostPath("/signup")}`;

const SAVE = "Save the refused email addresses";
const SAVED = "The refused email addresses were saved.";
const SIGNUP_SENT_MESSAGE =
  "We sent an email to the address you entered. Open it to continue.";
const DISPOSABLE_REFUSAL =
  "This site does not accept addresses from disposable email services. Use another email address.";
const LISTED_REFUSAL =
  "This site does not accept this email address. Use another email address.";

const listSwitch = (page: Page) =>
  page.getByRole("switch", { name: "Refuse disposable email domains" });

const entriesField = (page: Page) =>
  page.getByRole("textbox", { name: "Addresses and domains to refuse" });

const signUp = async (page: Page, email: string): Promise<void> => {
  await page.goto(signupUrl);
  await page.getByLabel("Name").fill(EMAIL_REJECTION_READER.name);
  await page.getByLabel("Email address").fill(email);
  await page
    .getByLabel("Password", { exact: true })
    .fill(EMAIL_REJECTION_READER.password);
  await page
    .getByLabel("Confirm password")
    .fill(EMAIL_REJECTION_READER.password);
  await page.getByRole("button", { name: "Sign up" }).click();
};

const accountCount = (email: string): string =>
  querySql(`
    SELECT count(*)
    FROM users u
    JOIN tenants t ON t.id = u.tenant_id
    WHERE t.public_id = '${EMAIL_REJECTION_TENANT}'
      AND u.email = '${email}';
  `);

const openSettings = (
  page: Page,
  account: { email: string; password: string } = EMAIL_REJECTION_ADMIN
) =>
  signInAsAdmin(page, account, "/settings", WEB_ADMIN_EMAIL_REJECTION_BASE_URL);

let disposableDomain: string;

// One setting for one tenant, so the tests run in order rather than beside
// each other, and each starts from what the one before it saved.
test.describe.configure({ mode: "serial" });

test.describe("web-admin email rejection", () => {
  test.beforeAll(async () => {
    applyScenarioSql(EMAIL_REJECTION_SCENARIO);
    const [domain] = await disposableEmailDomains();
    if (!domain) {
      throw new Error("the stack serves no disposable domain");
    }
    disposableDomain = domain;
  });

  test.afterAll(() => {
    applyScenarioSql(EMAIL_REJECTION_SCENARIO);
  });

  // The contrast the rest of the suite stands on: the list is named by the
  // platform, but a tenant that has not switched it on refuses nothing.
  test("a tenant that has set nothing accepts a disposable address", async ({
    page,
  }) => {
    const email = `before@${disposableDomain}`;
    await signUp(page, email);

    await expect(page.getByText(SIGNUP_SENT_MESSAGE)).toBeVisible();
    await expect.poll(() => accountCount(email)).toBe("1");
  });

  test("an administrator switches the list on, lists a domain, and sees both after a reload", async ({
    page,
  }) => {
    await openSettings(page);

    await expect(listSwitch(page)).toHaveAttribute("aria-checked", "false");
    await expect(entriesField(page)).toHaveValue("");
    // The stack names a list, so the switch is not said to do nothing.
    await expect(
      page.getByText(
        "The platform has no disposable domain list configured, so this switch has no effect until one is."
      )
    ).toBeHidden();

    await listSwitch(page).click();
    await entriesField(page).fill("  Refused.Example  \n\nsomeone@example.com");
    await page.getByRole("button", { name: SAVE }).click();

    await expect(page.getByText(SAVED)).toBeVisible();
    // Answered as stored: trimmed, lowercased, blank lines dropped, sorted.
    await expect(entriesField(page)).toHaveValue(
      "refused.example\nsomeone@example.com"
    );

    await page.reload();

    await expect(listSwitch(page)).toHaveAttribute("aria-checked", "true");
    await expect(entriesField(page)).toHaveValue(
      "refused.example\nsomeone@example.com"
    );
  });

  test("a line that is neither an address nor a domain is refused on the form", async ({
    page,
  }) => {
    await openSettings(page);

    await entriesField(page).fill("refused.example\nnot a domain");
    await page.getByRole("button", { name: SAVE }).click();

    await expect(
      page
        .getByText('"not a domain" is neither an email address nor a domain.')
        .first()
    ).toBeVisible();
    await expect(page.getByText(SAVED)).toBeHidden();

    await page.reload();

    await expect(entriesField(page)).toHaveValue(
      "refused.example\nsomeone@example.com"
    );
  });

  test("the storefront refuses a disposable address and a listed domain with a reason", async ({
    page,
  }) => {
    const disposable = `reader@${disposableDomain}`;
    await signUp(page, disposable);

    await expect(page.getByText(DISPOSABLE_REFUSAL)).toBeVisible();
    await expect(page).toHaveURL(signupUrl);

    // A subdomain of a listed domain is refused with it.
    const listed = "reader@mail.refused.example";
    await signUp(page, listed);

    await expect(page.getByText(LISTED_REFUSAL)).toBeVisible();

    // A refusal is answered before anything is written, so neither address
    // has an account to be found later.
    expect(accountCount(disposable)).toBe("0");
    expect(accountCount(listed)).toBe("0");
  });

  test("an editor sees the setting read-only", async ({ page }) => {
    await openSettings(page, EMAIL_REJECTION_EDITOR);

    await expect(page.getByRole("button", { name: SAVE })).toBeDisabled();
    await expect(entriesField(page)).toBeDisabled();
    // The API answers the setting to an administrator alone, so the card
    // shows nothing of it rather than a permission error.
    await expect(entriesField(page)).toHaveValue("");
    await expect(
      page.getByText(
        "You do not have permission to perform this action. Go back or use an account that does."
      )
    ).toBeHidden();
  });
});
