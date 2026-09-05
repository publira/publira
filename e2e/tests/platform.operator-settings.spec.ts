import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";

import { applyScenarioSql, querySql, runSql } from "../src/db";
import { clearMessagesTo, tokenFromLink, waitForMessageTo } from "../src/mail";
import {
  openPlatformUserMenu,
  signInAsPlatformOperator,
} from "../src/platform";
import {
  PLATFORM_OPERATOR_SETTINGS_EXPIRED_EMAIL,
  PLATFORM_OPERATOR_SETTINGS_NEW_EMAIL,
  PLATFORM_OPERATOR_SETTINGS_OPERATOR,
  PLATFORM_OPERATOR_SETTINGS_REPLY_TO,
  PLATFORM_OPERATOR_SETTINGS_SCENARIO,
  PLATFORM_SMTP_SEED_REPLY_TO,
} from "../src/scenarios/operator-settings";
import {
  expectLoginPage,
  fillLoginForm,
  LOGIN_FAILED_MESSAGE,
} from "../src/session";
import { WEB_PLATFORM_BASE_URL } from "../src/urls";

const platformUrl = (pathname: string): string =>
  `${WEB_PLATFORM_BASE_URL}${pathname}`;

const CONFIRM_EMAIL_PATH = "/confirm-email";

const SETTINGS_PATHS = ["/settings/account", "/settings/email"] as const;

const CHANGED_MESSAGE = "Your email address has been changed.";
const PENDING_NEW_EMAIL_MESSAGE =
  "This confirmation is done. The change applies once the new email address is confirmed as well.";
const FAILED_MESSAGE =
  "Could not change your email address. The link may have expired or be invalid.";
const WRONG_PASSWORD_MESSAGE = "The password is incorrect.";
const SMTP_SAVED_MESSAGE = "Email settings saved.";

const signIn = (page: Page, nextPath: string): Promise<void> =>
  signInAsPlatformOperator(page, PLATFORM_OPERATOR_SETTINGS_OPERATOR, nextPath);

const operatorEmail = (): string =>
  querySql(`
    SELECT email
    FROM platform_users
    WHERE public_id = '${PLATFORM_OPERATOR_SETTINGS_OPERATOR.publicId}';
  `);

const smtpReplyTo = (): string =>
  querySql(`
    SELECT reply_to
    FROM platform_smtp_config
    WHERE singleton;
  `);

const emailChangeTokenCount = (newEmail?: string): string => {
  const emailFilter =
    newEmail === undefined ? "" : ` AND t.new_email = '${newEmail}'`;
  return querySql(`
    SELECT COUNT(*)
    FROM platform_user_email_change_tokens t
    JOIN platform_users pu ON pu.id = t.platform_user_id
    WHERE pu.public_id = '${PLATFORM_OPERATOR_SETTINGS_OPERATOR.publicId}'${emailFilter};
  `);
};

const requestEmailChange = async (
  page: Page,
  currentEmail: string,
  newEmail: string,
  currentPassword: string = PLATFORM_OPERATOR_SETTINGS_OPERATOR.password
): Promise<void> => {
  await signIn(page, "/settings/account");

  await page.getByLabel("Current email address").fill(currentEmail);
  await page.getByLabel("New email address").fill(newEmail);
  await page.getByLabel("Current password").fill(currentPassword);
  await page.getByRole("button", { name: "Send confirmation email" }).click();
};

const confirmationTokenFor = async (recipient: string): Promise<string> => {
  const message = await waitForMessageTo(recipient);
  return tokenFromLink(message, CONFIRM_EMAIL_PATH);
};

/**
 * Open a confirmation link on the origin the browser reaches web-platform on.
 *
 * The mailed URL names the platform's seeded domain
 * (`https://platform.localhost/…`), which is neither the port web-platform
 * listens on nor a scheme this stack serves, so the token is carried over
 * rather than the whole link followed.
 */
const openConfirmation = (page: Page, token: string): Promise<unknown> =>
  page.goto(
    platformUrl(`${CONFIRM_EMAIL_PATH}?token=${encodeURIComponent(token)}`)
  );

/**
 * Wait until the request has actually issued a token.
 *
 * The platform account form does not render a success flash (`ActionForm`
 * defaults `showSuccess` off), so the row in the database is what reports
 * that the Action landed.
 */
const waitForEmailChangeToken = async (newEmail: string): Promise<void> => {
  await expect.poll(() => emailChangeTokenCount(newEmail)).toBe("1");
};

/**
 * The operator's own account and the platform SMTP settings.
 *
 * `/settings/account` is the email-address change, not a display-name or
 * password form — those controls are not on the console. `/settings/email` is
 * the platform default SMTP. Tokens are stored as hashes, so every
 * confirmation below opens a token this suite read out of Mailpit.
 *
 * The suite owns the account it moves — `131_platform_operator_settings.sql`
 * — and re-applies that scenario afterwards to put the original address and
 * Reply-to back. `mode: "serial"` keeps the confirmation of a request in the
 * same order as the request, and keeps the SMTP save last so a leftover
 * Reply-to cannot leak into a later assertion in this file.
 */
test.describe("web-platform operator settings", () => {
  test.describe.configure({ mode: "serial" });

  test.beforeAll(async () => {
    applyScenarioSql(PLATFORM_OPERATOR_SETTINGS_SCENARIO);
    await Promise.all([
      clearMessagesTo(PLATFORM_OPERATOR_SETTINGS_OPERATOR.email),
      clearMessagesTo(PLATFORM_OPERATOR_SETTINGS_NEW_EMAIL),
      clearMessagesTo(PLATFORM_OPERATOR_SETTINGS_EXPIRED_EMAIL),
    ]);
  });

  test.afterAll(() => {
    applyScenarioSql(PLATFORM_OPERATOR_SETTINGS_SCENARIO);
  });

  for (const settingsPath of SETTINGS_PATHS) {
    test(`${settingsPath} redirects to login while signed out`, async ({
      page,
    }) => {
      await page.goto(platformUrl(settingsPath));

      await expect(page).toHaveURL(/\/login\?next=/u);
      await expect(page).toHaveURL(
        new RegExp(`next=${encodeURIComponent(settingsPath)}`, "u")
      );
    });
  }

  test("the account screen names the signed-in operator in the header", async ({
    page,
  }) => {
    await signIn(page, "/settings/account");

    await expect(
      page.getByRole("heading", { level: 1, name: "Account" })
    ).toBeVisible();
    await expect(page.getByText("Change email address")).toBeVisible();

    await openPlatformUserMenu(page);
    await expect(
      page.getByText(PLATFORM_OPERATOR_SETTINGS_OPERATOR.name)
    ).toBeVisible();
    await expect(
      page.getByText(PLATFORM_OPERATOR_SETTINGS_OPERATOR.publicId)
    ).toBeVisible();
  });

  test("the account screen refuses an email change whose current password is wrong", async ({
    page,
  }) => {
    await requestEmailChange(
      page,
      PLATFORM_OPERATOR_SETTINGS_OPERATOR.email,
      PLATFORM_OPERATOR_SETTINGS_NEW_EMAIL,
      "wrong-password"
    );

    await expect(page.getByRole("status")).toContainText(
      WRONG_PASSWORD_MESSAGE
    );
    expect(operatorEmail()).toBe(PLATFORM_OPERATOR_SETTINGS_OPERATOR.email);
    expect(emailChangeTokenCount()).toBe("0");
  });

  test("an expired confirmation link reports the failure and leaves the address alone", async ({
    page,
  }) => {
    await requestEmailChange(
      page,
      PLATFORM_OPERATOR_SETTINGS_OPERATOR.email,
      PLATFORM_OPERATOR_SETTINGS_EXPIRED_EMAIL
    );
    await waitForEmailChangeToken(PLATFORM_OPERATOR_SETTINGS_EXPIRED_EMAIL);
    const token = await confirmationTokenFor(
      PLATFORM_OPERATOR_SETTINGS_EXPIRED_EMAIL
    );

    // The API dates the request 24 hours out, so nothing but the clock in the
    // row can put a link past its expiry inside a test run.
    runSql(`
      UPDATE platform_user_email_change_tokens
      SET expires_at = NOW() - INTERVAL '1 hour'
      WHERE new_email = '${PLATFORM_OPERATOR_SETTINGS_EXPIRED_EMAIL}';
    `);

    await openConfirmation(page, token);

    await expect(page.getByText(FAILED_MESSAGE)).toBeVisible();
    expect(operatorEmail()).toBe(PLATFORM_OPERATOR_SETTINGS_OPERATOR.email);
  });

  test("confirming from both addresses moves the account to the new one", async ({
    page,
  }) => {
    await Promise.all([
      clearMessagesTo(PLATFORM_OPERATOR_SETTINGS_OPERATOR.email),
      clearMessagesTo(PLATFORM_OPERATOR_SETTINGS_NEW_EMAIL),
    ]);

    await requestEmailChange(
      page,
      PLATFORM_OPERATOR_SETTINGS_OPERATOR.email,
      PLATFORM_OPERATOR_SETTINGS_NEW_EMAIL
    );
    await waitForEmailChangeToken(PLATFORM_OPERATOR_SETTINGS_NEW_EMAIL);
    const currentEmailToken = await confirmationTokenFor(
      PLATFORM_OPERATOR_SETTINGS_OPERATOR.email
    );
    const newEmailToken = await confirmationTokenFor(
      PLATFORM_OPERATOR_SETTINGS_NEW_EMAIL
    );

    await openConfirmation(page, currentEmailToken);
    await expect(page.getByText(PENDING_NEW_EMAIL_MESSAGE)).toBeVisible();
    expect(operatorEmail()).toBe(PLATFORM_OPERATOR_SETTINGS_OPERATOR.email);

    await openConfirmation(page, newEmailToken);
    await expect(page.getByText(CHANGED_MESSAGE)).toBeVisible();
    expect(operatorEmail()).toBe(PLATFORM_OPERATOR_SETTINGS_NEW_EMAIL);

    // A link an operator opens twice reports the change it completed, rather
    // than reading as a failure the second time.
    await openConfirmation(page, newEmailToken);
    await expect(page.getByText(CHANGED_MESSAGE)).toBeVisible();
  });

  test("the new address signs in afterwards and the previous one does not", async ({
    page,
  }) => {
    await page.goto(platformUrl("/login?next=%2Fsettings%2Faccount"));
    await fillLoginForm(page, PLATFORM_OPERATOR_SETTINGS_OPERATOR);

    await expectLoginPage(page);
    await expect(page.getByRole("status")).toContainText(LOGIN_FAILED_MESSAGE);

    await signInAsPlatformOperator(
      page,
      {
        email: PLATFORM_OPERATOR_SETTINGS_NEW_EMAIL,
        password: PLATFORM_OPERATOR_SETTINGS_OPERATOR.password,
      },
      "/settings/account"
    );

    await expect(page).toHaveURL(/\/settings\/account\/?$/u);
    await openPlatformUserMenu(page);
    await expect(
      page.getByText(PLATFORM_OPERATOR_SETTINGS_OPERATOR.publicId)
    ).toBeVisible();
  });

  test("the email settings screen saves a reply-to that survives a reload", async ({
    page,
  }) => {
    await signInAsPlatformOperator(
      page,
      {
        email: PLATFORM_OPERATOR_SETTINGS_NEW_EMAIL,
        password: PLATFORM_OPERATOR_SETTINGS_OPERATOR.password,
      },
      "/settings/email"
    );

    await expect(
      page.getByRole("heading", { level: 1, name: "Settings" })
    ).toBeVisible();
    await expect(page.getByText("Email settings")).toBeVisible();

    const replyTo = page.getByLabel("Reply-to address (optional)");
    await expect(replyTo).toHaveValue(PLATFORM_SMTP_SEED_REPLY_TO);
    await replyTo.fill(PLATFORM_OPERATOR_SETTINGS_REPLY_TO);
    await page.getByRole("button", { name: "Save" }).click();

    await expect(page.getByRole("status")).toContainText(SMTP_SAVED_MESSAGE);
    expect(smtpReplyTo()).toBe(PLATFORM_OPERATOR_SETTINGS_REPLY_TO);

    await page.goto(platformUrl("/settings/email"));
    await expect(page.getByLabel("Reply-to address (optional)")).toHaveValue(
      PLATFORM_OPERATOR_SETTINGS_REPLY_TO
    );
  });
});
