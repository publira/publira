import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";

import { applyScenarioSql, querySql, runSql } from "../src/db";
import { signInAsMember } from "../src/host";
import {
  clearMessagesTo,
  countMessagesTo,
  tokenFromLink,
  waitForMessageTo,
} from "../src/mail";
import {
  ACCOUNT_LIFECYCLE_EXPIRED_SIGNUP,
  ACCOUNT_LIFECYCLE_MEMBER,
  ACCOUNT_LIFECYCLE_REPLAY_PASSWORD,
  ACCOUNT_LIFECYCLE_RESET_PASSWORD,
  ACCOUNT_LIFECYCLE_SCENARIO,
  ACCOUNT_LIFECYCLE_SIGNUP,
  ACCOUNT_LIFECYCLE_UNKNOWN_EMAIL,
} from "../src/scenarios/account-lifecycle";
import {
  expectLoginPage,
  fillLoginForm,
  HOST_LOGIN_FAILED_MESSAGE,
  HOST_SESSION_COOKIE_NAME,
  sessionCookieValue,
} from "../src/session";
import { hostPath, WEB_HOST_BASE_URL } from "../src/urls";

const hostUrl = (pathname: string): string =>
  `${WEB_HOST_BASE_URL}${hostPath(pathname)}`;

/** The paths the mailed links point at, on the tenant's own domain. */
const VERIFY_PATH = "/verify";
const CONFIRM_PASSWORD_PATH = "/confirm-password";

const SIGNUP_SENT_MESSAGE =
  "We sent a confirmation email. Open the link in it to finish signing up.";
const SIGNUP_FAILED_MESSAGE =
  "Could not create your account. Please check what you entered.";
const VERIFIED_MESSAGE =
  "Your email address has been confirmed. You can sign in now.";
const VERIFY_FAILED_MESSAGE =
  "Could not confirm your email address. The link may have expired or be invalid.";
const RESET_SENT_MESSAGE =
  "We sent a reset email. Open the link in it to set a new password.";
const RESET_DONE_MESSAGE =
  "Your password has been reset. Sign in with your new password.";
const RESET_CONFIRM_FAILED_MESSAGE =
  "Could not reset your password. The link may have expired or be invalid.";

const accountStatus = (email: string): string =>
  querySql(`SELECT status FROM users WHERE email = '${email}';`);

const accountName = (email: string): string =>
  querySql(`SELECT name FROM users WHERE email = '${email}';`);

const accountCount = (email: string): string =>
  querySql(`SELECT count(*) FROM users WHERE email = '${email}';`);

const isEmailConfirmed = (email: string): boolean =>
  querySql(`
    SELECT email_verified_at IS NOT NULL
    FROM users
    WHERE email = '${email}';
  `) === "t";

/**
 * Whether the account's verification token has already been spent.
 *
 * A replay is only a replay against a token the flow has consumed, so the
 * tests below read this before reopening a link a second time.
 */
const isVerificationTokenUsed = (email: string): boolean =>
  querySql(`
    SELECT used_at IS NOT NULL
    FROM user_email_verification_tokens
    WHERE user_id = (SELECT id FROM users WHERE email = '${email}');
  `) === "t";

/**
 * The same, for the member's password reset. A request deletes the account's
 * earlier tokens before it issues one, so there is never more than a row here.
 */
const isResetTokenCompleted = (): boolean =>
  querySql(`
    SELECT completed_at IS NOT NULL
    FROM user_password_reset_tokens
    WHERE user_id = (
      SELECT id FROM users WHERE public_id = '${ACCOUNT_LIFECYCLE_MEMBER.publicId}'
    );
  `) === "t";

/**
 * Date the account's verification token out.
 *
 * The API issues it 24 hours ahead, so nothing but the clock in the row can
 * put a link past its expiry inside a test run.
 */
const expireVerificationToken = (email: string): void => {
  runSql(`
    UPDATE user_email_verification_tokens
    SET expires_at = NOW() - INTERVAL '1 hour'
    WHERE user_id = (SELECT id FROM users WHERE email = '${email}');
  `);
};

/** The same, for the member's outstanding password reset. */
const expireResetToken = (): void => {
  runSql(`
    UPDATE user_password_reset_tokens
    SET expires_at = NOW() - INTERVAL '1 hour'
    WHERE user_id = (
      SELECT id FROM users WHERE public_id = '${ACCOUNT_LIFECYCLE_MEMBER.publicId}'
    );
  `);
};

const sessionCookie = async (page: Page): Promise<string | undefined> => {
  const cookies = await page.context().cookies();
  return sessionCookieValue(cookies, HOST_SESSION_COOKIE_NAME);
};

/** Fill `/signup` and submit it. */
const submitSignup = async (
  page: Page,
  account: { email: string; name: string; password: string }
): Promise<void> => {
  await page.goto(hostUrl("/signup"));
  await page.getByLabel("Name").fill(account.name);
  await page.getByLabel("Email address").fill(account.email);
  await page.getByLabel("Password", { exact: true }).fill(account.password);
  await page.getByLabel("Confirm password").fill(account.password);
  await page.getByRole("button", { name: "Sign up" }).click();
};

/** Fill `/reset-password` and submit it. */
const submitResetRequest = async (page: Page, email: string): Promise<void> => {
  await page.goto(hostUrl("/reset-password"));
  await page.getByLabel("Email address").fill(email);
  await page.getByRole("button", { name: "Send reset email" }).click();
};

/**
 * Open a mailed link on the origin the browser reaches web-host on.
 *
 * The mailed URL names the tenant's seeded domain (`https://localhost/…`),
 * which is neither the port web-host listens on nor a scheme this stack
 * serves, so the token is carried over rather than the whole link followed.
 */
const openWithToken = (
  page: Page,
  pathname: string,
  token: string
): Promise<unknown> =>
  page.goto(hostUrl(`${pathname}?token=${encodeURIComponent(token)}`));

/** Set a new password on the `/confirm-password` form and submit it. */
const submitNewPassword = async (
  page: Page,
  password: string
): Promise<void> => {
  await page.getByLabel(/^New password\s*\*?$/u).fill(password);
  await page.getByLabel(/^Confirm new password\s*\*?$/u).fill(password);
  await page.getByRole("button", { name: "Reset password" }).click();
};

/**
 * A reader's first contact with a tenant site: signing up, confirming the
 * address, and resetting a forgotten password.
 *
 * Every token below is read out of Mailpit (`e2e/compose.yaml`), because the
 * API stores them hashed and the mailed link is the only readable form of one.
 *
 * The suite owns every account it touches — `100_account_lifecycle.sql` — and
 * re-applies that scenario afterwards to put the member's password back and
 * remove the accounts the sign-ups created. `mode: "serial"` keeps a
 * confirmation in the same order as the request that issued its token, keeps
 * a replay after the use it replays, and keeps the reset that changes the
 * member's password to the end.
 */
test.describe("web-host reader account lifecycle", () => {
  test.describe.configure({ mode: "serial" });

  test.beforeAll(async () => {
    applyScenarioSql(ACCOUNT_LIFECYCLE_SCENARIO);
    // Mail from an earlier run of this suite is still in the sink, and its
    // links point at tokens the scenario has just deleted.
    await Promise.all([
      clearMessagesTo(ACCOUNT_LIFECYCLE_SIGNUP.email),
      clearMessagesTo(ACCOUNT_LIFECYCLE_EXPIRED_SIGNUP.email),
      clearMessagesTo(ACCOUNT_LIFECYCLE_MEMBER.email),
      clearMessagesTo(ACCOUNT_LIFECYCLE_UNKNOWN_EMAIL),
    ]);
  });

  test.afterAll(() => {
    applyScenarioSql(ACCOUNT_LIFECYCLE_SCENARIO);
  });

  test("signing up lands on the pending page and issues no session", async ({
    page,
  }) => {
    await submitSignup(page, ACCOUNT_LIFECYCLE_SIGNUP);

    await page.waitForURL(/\/signup\/pending\/?$/u);
    await expect(page.getByText(SIGNUP_SENT_MESSAGE)).toBeVisible();
    await expect(
      page.getByText(`Sent to: ${ACCOUNT_LIFECYCLE_SIGNUP.email}`)
    ).toBeVisible();

    expect(await sessionCookie(page)).toBeUndefined();
    expect(accountStatus(ACCOUNT_LIFECYCLE_SIGNUP.email)).toBe("inactive");
    expect(isEmailConfirmed(ACCOUNT_LIFECYCLE_SIGNUP.email)).toBe(false);
  });

  test("the mailed link confirms the address and the new account signs in", async ({
    page,
  }) => {
    const message = await waitForMessageTo(ACCOUNT_LIFECYCLE_SIGNUP.email);
    const token = tokenFromLink(message, VERIFY_PATH);

    await openWithToken(page, VERIFY_PATH, token);

    await expect(page.getByText(VERIFIED_MESSAGE)).toBeVisible();
    expect(accountStatus(ACCOUNT_LIFECYCLE_SIGNUP.email)).toBe("active");
    expect(isEmailConfirmed(ACCOUNT_LIFECYCLE_SIGNUP.email)).toBe(true);

    await signInAsMember(page, ACCOUNT_LIFECYCLE_SIGNUP, "/my");

    await expect(page).toHaveURL(/\/my\/?$/u);
    await expect(
      page.getByRole("heading", { level: 1, name: "My Page" })
    ).toBeVisible();
    await expect(page.getByText(ACCOUNT_LIFECYCLE_SIGNUP.name)).toBeVisible();
    expect(await sessionCookie(page)).toBeTruthy();
  });

  test("reopening the consumed verification link reports the confirmation again", async ({
    page,
  }) => {
    // The same message the test above read; nothing has been sent to this
    // address since, so the link in it is the one the flow already spent.
    const message = await waitForMessageTo(ACCOUNT_LIFECYCLE_SIGNUP.email);
    const token = tokenFromLink(message, VERIFY_PATH);
    expect(isVerificationTokenUsed(ACCOUNT_LIFECYCLE_SIGNUP.email)).toBe(true);

    await openWithToken(page, VERIFY_PATH, token);

    // A reader who opens their link twice is told the address is confirmed,
    // rather than that something went wrong with a confirmation that worked.
    await expect(page.getByText(VERIFIED_MESSAGE)).toBeVisible();
    expect(accountStatus(ACCOUNT_LIFECYCLE_SIGNUP.email)).toBe("active");
    expect(isEmailConfirmed(ACCOUNT_LIFECYCLE_SIGNUP.email)).toBe(true);
  });

  /**
   * The copy gives nothing away, but the outcome still does: a free address
   * redirects to `/signup/pending` and a registered one stays here with an
   * error, which is enough to enumerate a tenant's readers — see
   * https://github.com/publira/publira/issues/1534. This test asserts what the
   * flow does today; closing that Issue means rewriting it to expect the
   * pending page for both.
   */
  test("signing up with a registered address is refused without naming it", async ({
    page,
  }) => {
    await clearMessagesTo(ACCOUNT_LIFECYCLE_MEMBER.email);

    await submitSignup(page, {
      email: ACCOUNT_LIFECYCLE_MEMBER.email,
      name: "Impersonating Signup",
      password: "another-password",
    });

    const flash = page.getByRole("status");
    await expect(flash).toContainText(SIGNUP_FAILED_MESSAGE);
    await expect(flash).not.toContainText(ACCOUNT_LIFECYCLE_MEMBER.email);
    await expect(page).toHaveURL(/\/signup\/?$/u);
    expect(await sessionCookie(page)).toBeUndefined();

    // The registered reader learns nothing either: no account was added under
    // their address, their own record is untouched, and nothing was mailed.
    expect(accountCount(ACCOUNT_LIFECYCLE_MEMBER.email)).toBe("1");
    expect(accountName(ACCOUNT_LIFECYCLE_MEMBER.email)).toBe(
      ACCOUNT_LIFECYCLE_MEMBER.name
    );
    expect(await countMessagesTo(ACCOUNT_LIFECYCLE_MEMBER.email)).toBe(0);
  });

  test("an expired verification link reports the failure and leaves the account unconfirmed", async ({
    page,
  }) => {
    await submitSignup(page, ACCOUNT_LIFECYCLE_EXPIRED_SIGNUP);
    await page.waitForURL(/\/signup\/pending\/?$/u);

    const message = await waitForMessageTo(
      ACCOUNT_LIFECYCLE_EXPIRED_SIGNUP.email
    );
    const token = tokenFromLink(message, VERIFY_PATH);
    expireVerificationToken(ACCOUNT_LIFECYCLE_EXPIRED_SIGNUP.email);

    await openWithToken(page, VERIFY_PATH, token);

    await expect(page.getByText(VERIFY_FAILED_MESSAGE)).toBeVisible();
    expect(accountStatus(ACCOUNT_LIFECYCLE_EXPIRED_SIGNUP.email)).toBe(
      "inactive"
    );
    expect(isEmailConfirmed(ACCOUNT_LIFECYCLE_EXPIRED_SIGNUP.email)).toBe(
      false
    );
  });

  test("a reset request for a registered address lands on the requested page", async ({
    page,
  }) => {
    await clearMessagesTo(ACCOUNT_LIFECYCLE_MEMBER.email);

    await submitResetRequest(page, ACCOUNT_LIFECYCLE_MEMBER.email);

    await page.waitForURL(/\/reset-password\/requested\/?$/u);
    await expect(page.getByText(RESET_SENT_MESSAGE)).toBeVisible();
    await expect(
      page.getByText(`Sent to: ${ACCOUNT_LIFECYCLE_MEMBER.email}`)
    ).toBeVisible();

    const message = await waitForMessageTo(ACCOUNT_LIFECYCLE_MEMBER.email);
    expect(tokenFromLink(message, CONFIRM_PASSWORD_PATH)).toHaveLength(64);
  });

  test("a reset request for an unregistered address lands on the same page and mails nothing", async ({
    page,
  }) => {
    await submitResetRequest(page, ACCOUNT_LIFECYCLE_UNKNOWN_EMAIL);

    await page.waitForURL(/\/reset-password\/requested\/?$/u);
    await expect(page.getByText(RESET_SENT_MESSAGE)).toBeVisible();
    await expect(
      page.getByText(`Sent to: ${ACCOUNT_LIFECYCLE_UNKNOWN_EMAIL}`)
    ).toBeVisible();

    expect(accountCount(ACCOUNT_LIFECYCLE_UNKNOWN_EMAIL)).toBe("0");
    expect(await countMessagesTo(ACCOUNT_LIFECYCLE_UNKNOWN_EMAIL)).toBe(0);
  });

  test("an expired reset link reports the failure and leaves the password alone", async ({
    page,
  }) => {
    await clearMessagesTo(ACCOUNT_LIFECYCLE_MEMBER.email);
    await submitResetRequest(page, ACCOUNT_LIFECYCLE_MEMBER.email);
    await page.waitForURL(/\/reset-password\/requested\/?$/u);

    const message = await waitForMessageTo(ACCOUNT_LIFECYCLE_MEMBER.email);
    const token = tokenFromLink(message, CONFIRM_PASSWORD_PATH);
    expireResetToken();

    await openWithToken(page, CONFIRM_PASSWORD_PATH, token);
    await submitNewPassword(page, ACCOUNT_LIFECYCLE_RESET_PASSWORD);

    await expect(page.getByRole("status")).toContainText(
      RESET_CONFIRM_FAILED_MESSAGE
    );

    await signInAsMember(page, ACCOUNT_LIFECYCLE_MEMBER, "/my");
    await expect(page).toHaveURL(/\/my\/?$/u);
  });

  test("the mailed link sets a new password, and only the new one signs in", async ({
    page,
  }) => {
    await clearMessagesTo(ACCOUNT_LIFECYCLE_MEMBER.email);
    await submitResetRequest(page, ACCOUNT_LIFECYCLE_MEMBER.email);
    await page.waitForURL(/\/reset-password\/requested\/?$/u);

    const message = await waitForMessageTo(ACCOUNT_LIFECYCLE_MEMBER.email);
    const token = tokenFromLink(message, CONFIRM_PASSWORD_PATH);

    await openWithToken(page, CONFIRM_PASSWORD_PATH, token);
    await submitNewPassword(page, ACCOUNT_LIFECYCLE_RESET_PASSWORD);

    await page.waitForURL(/\/login\?reset=done$/u);
    await expect(page.getByRole("status")).toContainText(RESET_DONE_MESSAGE);

    await page.goto(hostUrl("/login?returnTo=%2Fmy"));
    await fillLoginForm(page, ACCOUNT_LIFECYCLE_MEMBER);
    await expectLoginPage(page);
    await expect(page.getByRole("status")).toContainText(
      HOST_LOGIN_FAILED_MESSAGE
    );

    await signInAsMember(
      page,
      {
        email: ACCOUNT_LIFECYCLE_MEMBER.email,
        password: ACCOUNT_LIFECYCLE_RESET_PASSWORD,
      },
      "/my"
    );

    await expect(page).toHaveURL(/\/my\/?$/u);
    await expect(
      page.getByText(ACCOUNT_LIFECYCLE_MEMBER.publicId)
    ).toBeVisible();
  });

  test("reopening the consumed reset link cannot set a second password", async ({
    page,
  }) => {
    // The same message the test above spent, so this is a genuine replay of a
    // completed reset rather than a fresh one.
    const message = await waitForMessageTo(ACCOUNT_LIFECYCLE_MEMBER.email);
    const token = tokenFromLink(message, CONFIRM_PASSWORD_PATH);
    expect(isResetTokenCompleted()).toBe(true);

    await openWithToken(page, CONFIRM_PASSWORD_PATH, token);
    await submitNewPassword(page, ACCOUNT_LIFECYCLE_REPLAY_PASSWORD);

    // The completed reset is reported as done rather than as a failure, the
    // way a confirmation link opened twice is — but the password it carried
    // never reaches the account.
    await page.waitForURL(/\/login\?reset=done$/u);

    await page.goto(hostUrl("/login?returnTo=%2Fmy"));
    await fillLoginForm(page, {
      email: ACCOUNT_LIFECYCLE_MEMBER.email,
      password: ACCOUNT_LIFECYCLE_REPLAY_PASSWORD,
    });
    await expectLoginPage(page);
    await expect(page.getByRole("status")).toContainText(
      HOST_LOGIN_FAILED_MESSAGE
    );

    await signInAsMember(
      page,
      {
        email: ACCOUNT_LIFECYCLE_MEMBER.email,
        password: ACCOUNT_LIFECYCLE_RESET_PASSWORD,
      },
      "/my"
    );
    await expect(page).toHaveURL(/\/my\/?$/u);
  });
});
