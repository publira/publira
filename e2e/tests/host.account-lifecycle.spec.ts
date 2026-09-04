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
  ACCOUNT_LIFECYCLE_RESET_PASSWORD,
  ACCOUNT_LIFECYCLE_SCENARIO,
  ACCOUNT_LIFECYCLE_SIGNUP,
  ACCOUNT_LIFECYCLE_UNKNOWN_EMAIL,
} from "../src/scenarios/account-lifecycle";
import {
  expectLoginPage,
  fillLoginForm,
  HOST_SESSION_COOKIE_NAME,
  LOGIN_FAILED_MESSAGE,
  sessionCookieValue,
} from "../src/session";
import { hostPath, WEB_HOST_BASE_URL } from "../src/urls";

const hostUrl = (pathname: string): string =>
  `${WEB_HOST_BASE_URL}${hostPath(pathname)}`;

/** The paths the mailed links point at, on the tenant's own domain. */
const VERIFY_PATH = "/verify";
const CONFIRM_PASSWORD_PATH = "/confirm-password";

const SIGNUP_SENT_MESSAGE =
  "確認メールを送信しました。メール内のリンクを開いて登録を完了してください。";
const SIGNUP_FAILED_MESSAGE =
  "新規登録に失敗しました。入力内容をご確認ください。";
const VERIFIED_MESSAGE =
  "メールアドレスの確認が完了しました。ログインしてください。";
const VERIFY_FAILED_MESSAGE =
  "確認に失敗しました。リンクの有効期限切れ、または無効なリンクの可能性があります。";
const RESET_SENT_MESSAGE =
  "再設定メールを送信しました。メール内のリンクを開いて新しいパスワードを設定してください。";
const RESET_DONE_MESSAGE =
  "パスワードを再設定しました。新しいパスワードでログインしてください。";
const RESET_CONFIRM_FAILED_MESSAGE =
  "再設定に失敗しました。リンクの有効期限切れ、または無効なリンクの可能性があります。";

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
  await page.getByLabel("お名前").fill(account.name);
  await page.getByLabel("メールアドレス").fill(account.email);
  await page.getByLabel("パスワード", { exact: true }).fill(account.password);
  await page.getByLabel("パスワード（確認）").fill(account.password);
  await page.getByRole("button", { name: "新規登録" }).click();
};

/** Fill `/reset-password` and submit it. */
const submitResetRequest = async (page: Page, email: string): Promise<void> => {
  await page.goto(hostUrl("/reset-password"));
  await page.getByLabel("メールアドレス").fill(email);
  await page.getByRole("button", { name: "再設定メールを送信" }).click();
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
  await page.getByLabel(/^新しいパスワード\s*\*?$/u).fill(password);
  await page.getByLabel(/^新しいパスワード（確認）\s*\*?$/u).fill(password);
  await page.getByRole("button", { name: "パスワードを再設定" }).click();
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
 * confirmation in the same order as the request that issued its token, and
 * keeps the reset that changes the member's password last.
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
      page.getByText(`送信先: ${ACCOUNT_LIFECYCLE_SIGNUP.email}`)
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
      page.getByRole("heading", { level: 1, name: "マイページ" })
    ).toBeVisible();
    await expect(page.getByText(ACCOUNT_LIFECYCLE_SIGNUP.name)).toBeVisible();
    expect(await sessionCookie(page)).toBeTruthy();
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
      page.getByText(`送信先: ${ACCOUNT_LIFECYCLE_MEMBER.email}`)
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
      page.getByText(`送信先: ${ACCOUNT_LIFECYCLE_UNKNOWN_EMAIL}`)
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
    await expect(page.getByRole("status")).toContainText(LOGIN_FAILED_MESSAGE);

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
});
