import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";

import { fillField, openAdminUserMenu, signInAsAdmin } from "../src/admin";
import { applyScenarioSql, querySql, runSql } from "../src/db";
import { clearMessagesTo, tokenFromLink, waitForMessageTo } from "../src/mail";
import {
  ADMIN_OPERATOR_SETTINGS_ADMIN,
  ADMIN_OPERATOR_SETTINGS_EXPIRED_EMAIL,
  ADMIN_OPERATOR_SETTINGS_FROM_NAME,
  ADMIN_OPERATOR_SETTINGS_NEW_EMAIL,
  ADMIN_OPERATOR_SETTINGS_SCENARIO,
  ADMIN_OPERATOR_SETTINGS_TENANT,
} from "../src/scenarios/operator-settings";
import {
  expectLoginPage,
  fillLoginForm,
  LOGIN_FAILED_MESSAGE,
} from "../src/session";
import { WEB_ADMIN_OPERATOR_SETTINGS_BASE_URL } from "../src/urls";

const adminUrl = (pathname: string): string =>
  `${WEB_ADMIN_OPERATOR_SETTINGS_BASE_URL}${pathname}`;

const CONFIRM_EMAIL_PATH = "/confirm-email";

const SETTINGS_PATHS = ["/settings/account", "/settings/email"] as const;

const REQUESTED_MESSAGE =
  "A confirmation email was sent to both the current and the new address. Open both links to complete the change.";
const CHANGED_MESSAGE = "Your email address has been changed.";
const PENDING_MESSAGE = "Confirmation is complete.";
const FAILED_MESSAGE =
  "Could not change your email address. The link may have expired or be invalid.";
const WRONG_PASSWORD_MESSAGE = "That password is not correct.";
const SMTP_SAVED_MESSAGE = "The email settings were saved.";
const SEED_FROM_NAME = "Operator Settings Tenant Mail";

const signIn = (page: Page, nextPath: string): Promise<void> =>
  signInAsAdmin(
    page,
    ADMIN_OPERATOR_SETTINGS_ADMIN,
    nextPath,
    WEB_ADMIN_OPERATOR_SETTINGS_BASE_URL
  );

const adminEmail = (): string =>
  querySql(`
    SELECT email
    FROM users
    WHERE public_id = '${ADMIN_OPERATOR_SETTINGS_ADMIN.publicId}';
  `);

const smtpFromName = (): string =>
  querySql(`
    SELECT from_name
    FROM tenant_smtp_config
    WHERE tenant_id = (
      SELECT id FROM tenants
      WHERE public_id = '${ADMIN_OPERATOR_SETTINGS_TENANT.publicId}'
    );
  `);

const smtpOverrideEnabled = (): boolean =>
  querySql(`
    SELECT smtp_override_enabled
    FROM tenant_smtp_config
    WHERE tenant_id = (
      SELECT id FROM tenants
      WHERE public_id = '${ADMIN_OPERATOR_SETTINGS_TENANT.publicId}'
    );
  `) === "t";

const emailChangeTokenCount = (): string =>
  querySql(`
    SELECT COUNT(*)
    FROM user_email_change_tokens t
    JOIN users u ON u.id = t.user_id
    WHERE u.public_id = '${ADMIN_OPERATOR_SETTINGS_ADMIN.publicId}';
  `);

/**
 * Point this tenant's SMTP row at the stack's Mailpit.
 *
 * The scenario names the Dev Container `mailpit` host, which does not resolve
 * from the E2E host processes. `task e2e:db` rewrites every row that existed
 * then; this tenant's row is applied later, so the suite has to do the same
 * rewrite itself. Host and port are the only columns it may touch: a leftover
 * override or from-name is what the scenario puts back.
 */
const pointTenantSmtpAtMailpit = (): void => {
  const port = process.env.E2E_MAILPIT_SMTP_PORT?.trim() || "1026";
  if (!/^\d+$/u.test(port)) {
    throw new Error(`invalid E2E_MAILPIT_SMTP_PORT: ${port}`);
  }
  runSql(`
    UPDATE tenant_smtp_config
    SET host = '127.0.0.1',
        port = ${port},
        updated_at = NOW()
    WHERE tenant_id = (
      SELECT id FROM tenants
      WHERE public_id = '${ADMIN_OPERATOR_SETTINGS_TENANT.publicId}'
    );
  `);
};

const requestEmailChange = async (
  page: Page,
  currentEmail: string,
  newEmail: string,
  currentPassword: string = ADMIN_OPERATOR_SETTINGS_ADMIN.password
): Promise<void> => {
  await signIn(page, "/settings/account");

  await fillField(page.getByLabel("Current email address"), currentEmail);
  await fillField(page.getByLabel("New email address"), newEmail);
  await fillField(page.getByLabel("Current password"), currentPassword);
  await page
    .getByRole("button", { name: "Send the confirmation email" })
    .click();
};

const confirmationTokenFor = async (recipient: string): Promise<string> => {
  const message = await waitForMessageTo(recipient);
  return tokenFromLink(message, CONFIRM_EMAIL_PATH);
};

/**
 * Open a confirmation link on the origin the browser reaches this tenant's
 * console on.
 *
 * The mailed URL names the seeded admin domain (`https://admin.aset.localhost/…`),
 * which is neither the port web-admin listens on nor a scheme this stack
 * serves, so the token is carried over rather than the whole link followed.
 */
const openConfirmation = (page: Page, token: string): Promise<unknown> =>
  page.goto(
    adminUrl(`${CONFIRM_EMAIL_PATH}?token=${encodeURIComponent(token)}`)
  );

/**
 * The administrator's own account and this tenant's SMTP settings.
 *
 * `/settings/account` is the email-address change, not a display-name or
 * password form — those controls are not on the console. `/settings/email` is
 * the tenant SMTP override. Tokens are stored as hashes, so every confirmation
 * below opens a token this suite read out of Mailpit.
 *
 * The suite owns the account and the tenant it rewrites —
 * `130_admin_operator_settings.sql` — and re-applies that scenario afterwards
 * to put the original address and SMTP row back. `mode: "serial"` keeps the
 * confirmation of a request in the same order as the request, and keeps the
 * SMTP save after the mail-sending tests so an enabled override cannot reroute
 * them.
 */
test.describe("web-admin operator settings", () => {
  test.describe.configure({ mode: "serial" });

  test.beforeAll(async () => {
    applyScenarioSql(ADMIN_OPERATOR_SETTINGS_SCENARIO);
    pointTenantSmtpAtMailpit();
    await Promise.all([
      clearMessagesTo(ADMIN_OPERATOR_SETTINGS_ADMIN.email),
      clearMessagesTo(ADMIN_OPERATOR_SETTINGS_NEW_EMAIL),
      clearMessagesTo(ADMIN_OPERATOR_SETTINGS_EXPIRED_EMAIL),
    ]);
  });

  test.afterAll(() => {
    applyScenarioSql(ADMIN_OPERATOR_SETTINGS_SCENARIO);
  });

  for (const settingsPath of SETTINGS_PATHS) {
    test(`${settingsPath} redirects to login while signed out`, async ({
      page,
    }) => {
      await page.goto(adminUrl(settingsPath));

      await expect(page).toHaveURL(/\/login\?next=/u);
      await expect(page).toHaveURL(
        new RegExp(`next=${encodeURIComponent(settingsPath)}`, "u")
      );
    });
  }

  test("the account screen names the signed-in administrator in the header", async ({
    page,
  }) => {
    await signIn(page, "/settings/account");

    await expect(
      page.getByRole("heading", { level: 1, name: "Account settings" })
    ).toBeVisible();
    await expect(page.getByText("Change the email address")).toBeVisible();

    await openAdminUserMenu(page);
    await expect(
      page.getByText(ADMIN_OPERATOR_SETTINGS_ADMIN.name)
    ).toBeVisible();
    await expect(
      page.getByText(ADMIN_OPERATOR_SETTINGS_ADMIN.publicId)
    ).toBeVisible();
  });

  test("the account screen refuses an email change whose current password is wrong", async ({
    page,
  }) => {
    await requestEmailChange(
      page,
      ADMIN_OPERATOR_SETTINGS_ADMIN.email,
      ADMIN_OPERATOR_SETTINGS_NEW_EMAIL,
      "wrong-password"
    );

    await expect(page.getByRole("status")).toContainText(
      WRONG_PASSWORD_MESSAGE
    );
    expect(adminEmail()).toBe(ADMIN_OPERATOR_SETTINGS_ADMIN.email);
    expect(emailChangeTokenCount()).toBe("0");
  });

  test("an expired confirmation link reports the failure and leaves the address alone", async ({
    page,
  }) => {
    await requestEmailChange(
      page,
      ADMIN_OPERATOR_SETTINGS_ADMIN.email,
      ADMIN_OPERATOR_SETTINGS_EXPIRED_EMAIL
    );
    await expect(page.getByRole("status")).toContainText(REQUESTED_MESSAGE);
    const token = await confirmationTokenFor(
      ADMIN_OPERATOR_SETTINGS_EXPIRED_EMAIL
    );

    // The API dates the request 24 hours out, so nothing but the clock in the
    // row can put a link past its expiry inside a test run.
    runSql(`
      UPDATE user_email_change_tokens
      SET expires_at = NOW() - INTERVAL '1 hour'
      WHERE new_email = '${ADMIN_OPERATOR_SETTINGS_EXPIRED_EMAIL}';
    `);

    await openConfirmation(page, token);

    await expect(page.getByText(FAILED_MESSAGE)).toBeVisible();
    expect(adminEmail()).toBe(ADMIN_OPERATOR_SETTINGS_ADMIN.email);
  });

  test("confirming from both addresses moves the account to the new one", async ({
    page,
  }) => {
    await Promise.all([
      clearMessagesTo(ADMIN_OPERATOR_SETTINGS_ADMIN.email),
      clearMessagesTo(ADMIN_OPERATOR_SETTINGS_NEW_EMAIL),
    ]);

    await requestEmailChange(
      page,
      ADMIN_OPERATOR_SETTINGS_ADMIN.email,
      ADMIN_OPERATOR_SETTINGS_NEW_EMAIL
    );
    await expect(page.getByRole("status")).toContainText(REQUESTED_MESSAGE);
    const currentEmailToken = await confirmationTokenFor(
      ADMIN_OPERATOR_SETTINGS_ADMIN.email
    );
    const newEmailToken = await confirmationTokenFor(
      ADMIN_OPERATOR_SETTINGS_NEW_EMAIL
    );

    await openConfirmation(page, currentEmailToken);
    await expect(
      page.getByText(PENDING_MESSAGE, { exact: true })
    ).toBeVisible();
    expect(adminEmail()).toBe(ADMIN_OPERATOR_SETTINGS_ADMIN.email);

    await openConfirmation(page, newEmailToken);
    await expect(
      page.getByText(CHANGED_MESSAGE, { exact: true })
    ).toBeVisible();
    expect(adminEmail()).toBe(ADMIN_OPERATOR_SETTINGS_NEW_EMAIL);

    // A link an operator opens twice reports the change it completed, rather
    // than reading as a failure the second time.
    await openConfirmation(page, newEmailToken);
    await expect(
      page.getByText(CHANGED_MESSAGE, { exact: true })
    ).toBeVisible();
  });

  test("the new address signs in afterwards and the previous one does not", async ({
    page,
  }) => {
    await page.goto(adminUrl("/login?next=%2Fsettings%2Faccount"));
    await fillLoginForm(page, ADMIN_OPERATOR_SETTINGS_ADMIN);

    await expectLoginPage(page);
    await expect(page.getByRole("status")).toContainText(LOGIN_FAILED_MESSAGE);

    await signInAsAdmin(
      page,
      {
        email: ADMIN_OPERATOR_SETTINGS_NEW_EMAIL,
        password: ADMIN_OPERATOR_SETTINGS_ADMIN.password,
      },
      "/settings/account",
      WEB_ADMIN_OPERATOR_SETTINGS_BASE_URL
    );

    await expect(page).toHaveURL(/\/settings\/account\/?$/u);
    await openAdminUserMenu(page);
    await expect(
      page.getByText(ADMIN_OPERATOR_SETTINGS_ADMIN.publicId)
    ).toBeVisible();
  });

  test("the email settings screen saves a sender name that survives a reload", async ({
    page,
  }) => {
    await signInAsAdmin(
      page,
      {
        email: ADMIN_OPERATOR_SETTINGS_NEW_EMAIL,
        password: ADMIN_OPERATOR_SETTINGS_ADMIN.password,
      },
      "/settings/email",
      WEB_ADMIN_OPERATOR_SETTINGS_BASE_URL
    );

    await expect(
      page.getByRole("heading", { level: 1, name: "Settings" })
    ).toBeVisible();
    await expect(page.getByText("Email settings")).toBeVisible();

    const fromName = page.getByLabel("Sender name (optional)");
    await expect(fromName).toHaveValue(SEED_FROM_NAME);
    await expect(fromName).toBeDisabled();
    expect(smtpOverrideEnabled()).toBe(false);

    await page.getByRole("checkbox", { name: "Enable the override" }).check();
    await expect(fromName).toBeEnabled();
    await fillField(fromName, ADMIN_OPERATOR_SETTINGS_FROM_NAME);
    await page.getByRole("button", { name: "Save" }).click();

    await expect(page.getByRole("status")).toContainText(SMTP_SAVED_MESSAGE);
    expect(smtpFromName()).toBe(ADMIN_OPERATOR_SETTINGS_FROM_NAME);
    expect(smtpOverrideEnabled()).toBe(true);

    await page.goto(adminUrl("/settings/email"));
    await expect(page.getByLabel("Sender name (optional)")).toHaveValue(
      ADMIN_OPERATOR_SETTINGS_FROM_NAME
    );
    await expect(
      page.getByRole("checkbox", { name: "Enable the override" })
    ).toBeChecked();
  });
});
