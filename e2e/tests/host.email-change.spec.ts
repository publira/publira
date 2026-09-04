import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";

import { applyScenarioSql, querySql, runSql } from "../src/db";
import { signInAsMember } from "../src/host";
import { clearMessagesTo, tokenFromLink, waitForMessageTo } from "../src/mail";
import {
  EMAIL_CHANGE_EXPIRED_EMAIL,
  EMAIL_CHANGE_MEMBER,
  EMAIL_CHANGE_NEW_EMAIL,
  EMAIL_CHANGE_SCENARIO,
} from "../src/scenarios/email-change";
import {
  expectLoginPage,
  fillLoginForm,
  HOST_LOGIN_FAILED_MESSAGE,
} from "../src/session";
import { hostPath, WEB_HOST_BASE_URL } from "../src/urls";

const hostUrl = (pathname: string): string =>
  `${WEB_HOST_BASE_URL}${hostPath(pathname)}`;

/** The path the mailed link points at, on the tenant's own domain. */
const CONFIRM_EMAIL_PATH = "/confirm-email";

const CHANGED_MESSAGE = "Your email address has been changed.";
const PENDING_NEW_EMAIL_MESSAGE =
  "This confirmation is complete. The change takes effect once the new address is confirmed as well.";
const FAILED_MESSAGE =
  "Could not change your email address. The link may have expired or be invalid.";

const memberEmail = (): string =>
  querySql(`
    SELECT email
    FROM users
    WHERE public_id = '${EMAIL_CHANGE_MEMBER.publicId}';
  `);

/**
 * Sign in and ask `/settings/security` to move the account to `newEmail`.
 *
 * The Action reports itself by redirecting back with `status` in the query.
 * The rendered flash is not asserted: `settings/layout.tsx` draws it from a
 * `searchParams` prop the App Router never hands a layout, so nothing reaches
 * the screen — see https://github.com/publira/publira/issues/1489.
 */
const requestEmailChange = async (
  page: Page,
  currentEmail: string,
  newEmail: string
): Promise<void> => {
  await signInAsMember(
    page,
    { email: currentEmail, password: EMAIL_CHANGE_MEMBER.password },
    "/settings/security"
  );

  await page.getByLabel("Current email address").fill(currentEmail);
  await page.getByLabel("New email address").fill(newEmail);
  await page.getByLabel("Current password").fill(EMAIL_CHANGE_MEMBER.password);
  await page.getByRole("button", { name: "Send confirmation emails" }).click();

  await page.waitForURL(/[?&]status=success(?:&|$)/u);
};

/** The token out of the confirmation link mailed to `recipient`. */
const confirmationTokenFor = async (recipient: string): Promise<string> => {
  const message = await waitForMessageTo(recipient);
  return tokenFromLink(message, CONFIRM_EMAIL_PATH);
};

/**
 * Open a confirmation link on the origin the browser reaches web-host on.
 *
 * The mailed URL names the tenant's seeded domain (`https://localhost/…`),
 * which is neither the port web-host listens on nor a scheme this stack
 * serves, so the token is carried over rather than the whole link followed.
 */
const openConfirmation = (page: Page, token: string): Promise<unknown> =>
  page.goto(
    hostUrl(`${CONFIRM_EMAIL_PATH}?token=${encodeURIComponent(token)}`)
  );

/**
 * Changing a reader's email address, from the request to the address the
 * account signs in with afterwards.
 *
 * The tokens are stored as hashes, so the only readable form of one is the
 * link the API mailed: every confirmation below opens a token this suite read
 * out of Mailpit (`e2e/compose.yaml`), the same sink the Dev Container has and
 * the CI runner now does too.
 *
 * The suite owns the account it moves — `090_email_change.sql` — and re-applies
 * that scenario afterwards to put the original address back. `mode: "serial"`
 * keeps the confirmation of a request in the same order as the request.
 */
test.describe("web-host email address change", () => {
  test.describe.configure({ mode: "serial" });

  test.beforeAll(async () => {
    applyScenarioSql(EMAIL_CHANGE_SCENARIO);
    // Mail from an earlier run of this suite is still in the sink, and its
    // links point at tokens the scenario has just deleted.
    await Promise.all([
      clearMessagesTo(EMAIL_CHANGE_MEMBER.email),
      clearMessagesTo(EMAIL_CHANGE_NEW_EMAIL),
      clearMessagesTo(EMAIL_CHANGE_EXPIRED_EMAIL),
    ]);
  });

  test.afterAll(() => {
    applyScenarioSql(EMAIL_CHANGE_SCENARIO);
  });

  test("an expired confirmation link reports the failure and leaves the address alone", async ({
    page,
  }) => {
    await requestEmailChange(
      page,
      EMAIL_CHANGE_MEMBER.email,
      EMAIL_CHANGE_EXPIRED_EMAIL
    );
    const token = await confirmationTokenFor(EMAIL_CHANGE_EXPIRED_EMAIL);

    // The API dates the request 24 hours out, so nothing but the clock in the
    // row can put a link past its expiry inside a test run.
    runSql(`
      UPDATE user_email_change_tokens
      SET expires_at = NOW() - INTERVAL '1 hour'
      WHERE new_email = '${EMAIL_CHANGE_EXPIRED_EMAIL}';
    `);

    await openConfirmation(page, token);

    await expect(page.getByText(FAILED_MESSAGE)).toBeVisible();
    expect(memberEmail()).toBe(EMAIL_CHANGE_MEMBER.email);
  });

  test("confirming from both addresses moves the account to the new one", async ({
    page,
  }) => {
    await Promise.all([
      clearMessagesTo(EMAIL_CHANGE_MEMBER.email),
      clearMessagesTo(EMAIL_CHANGE_NEW_EMAIL),
    ]);

    await requestEmailChange(
      page,
      EMAIL_CHANGE_MEMBER.email,
      EMAIL_CHANGE_NEW_EMAIL
    );
    const currentEmailToken = await confirmationTokenFor(
      EMAIL_CHANGE_MEMBER.email
    );
    const newEmailToken = await confirmationTokenFor(EMAIL_CHANGE_NEW_EMAIL);

    await openConfirmation(page, currentEmailToken);
    await expect(page.getByText(PENDING_NEW_EMAIL_MESSAGE)).toBeVisible();
    expect(memberEmail()).toBe(EMAIL_CHANGE_MEMBER.email);

    await openConfirmation(page, newEmailToken);
    await expect(page.getByText(CHANGED_MESSAGE)).toBeVisible();
    expect(memberEmail()).toBe(EMAIL_CHANGE_NEW_EMAIL);

    // A link a reader opens twice reports the change it completed, rather than
    // reading as a failure the second time.
    await openConfirmation(page, newEmailToken);
    await expect(page.getByText(CHANGED_MESSAGE)).toBeVisible();
  });

  test("the new address signs in afterwards and the previous one does not", async ({
    page,
  }) => {
    await page.goto(hostUrl("/login?returnTo=%2Fmy"));
    await fillLoginForm(page, {
      email: EMAIL_CHANGE_MEMBER.email,
      password: EMAIL_CHANGE_MEMBER.password,
    });

    await expectLoginPage(page);
    await expect(page.getByRole("status")).toContainText(
      HOST_LOGIN_FAILED_MESSAGE
    );

    await signInAsMember(
      page,
      { email: EMAIL_CHANGE_NEW_EMAIL, password: EMAIL_CHANGE_MEMBER.password },
      "/my"
    );

    await expect(page).toHaveURL(/\/my\/?$/u);
    await expect(page.getByText(EMAIL_CHANGE_MEMBER.publicId)).toBeVisible();
  });
});
