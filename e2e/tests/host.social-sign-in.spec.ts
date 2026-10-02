import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";

import { applyScenarioSql, querySql } from "../src/db";
import { openHostUserMenu, signInAsMember, signOutHost } from "../src/host";
import { clearMessagesTo, tokenFromLink, waitForMessageTo } from "../src/mail";
import {
  SOCIAL_SIGN_IN_CONSENT_TENANT,
  SOCIAL_SIGN_IN_MEMBER,
  SOCIAL_SIGN_IN_SCENARIO,
  SOCIAL_SIGN_IN_TENANT,
  SOCIAL_SIGN_IN_TERMS_PAGE,
} from "../src/scenarios/social-sign-in";
import { expectLoginPage } from "../src/session";
import { stubGoogleSignIn } from "../src/sign-in-provider";
import type { GoogleAccount } from "../src/sign-in-provider";
import {
  hostPath,
  WEB_HOST_BASE_URL,
  WEB_HOST_SOCIAL_SIGN_IN_BASE_URL,
  WEB_HOST_SOCIAL_SIGN_IN_CONSENT_BASE_URL,
} from "../src/urls";

/**
 * A tenant that offers Apple and Google puts a button for each on its sign-in
 * screen, and a reader who picks Google comes back signed in: to a new account
 * on a first sign-in, to the same one on the next, and to the account already
 * holding the address Google vouches for. A tenant that asks for consent asks
 * before the account is created. A linked account is listed in the security
 * settings and can be unlinked. An account without a password confirms an
 * email change and its deletion by signing in again, and sets a first password
 * through the reset flow.
 *
 * Google is played by a route that answers its authorization endpoint the way
 * `response_mode=form_post` does, with an ID token the stack's sign-in-provider
 * stand-in signs; everything after that is the site and the API as deployed.
 */

const socialUrl = (pathname: string): string =>
  `${WEB_HOST_SOCIAL_SIGN_IN_BASE_URL}${hostPath(pathname)}`;

const CONTINUE_WITH_GOOGLE = "Continue with Google";
const CONTINUE_WITH_APPLE = "Continue with Apple";

const NEWCOMER: GoogleAccount = {
  email: "social-newcomer@example.com",
  name: "Social Newcomer",
  subject: "google-social-newcomer",
};

const MEMBER_GOOGLE: GoogleAccount = {
  email: SOCIAL_SIGN_IN_MEMBER.email,
  name: "Member at Google",
  subject: "google-social-member",
};

/** An account Google creates, which then moves to another address. */
const MOVER: GoogleAccount = {
  email: "social-mover@example.com",
  name: "Social Mover",
  subject: "google-social-mover",
};
const MOVER_NEW_EMAIL = "social-mover-moved@example.com";
const MOVER_PASSWORD = "moverpass1";

const CONSENT_NEWCOMER: GoogleAccount = {
  email: "social-consent-newcomer@example.com",
  name: "Consent Newcomer",
  subject: "google-social-consent-newcomer",
};

const accountCount = (tenantPublicId: string, email: string): string =>
  querySql(`
    SELECT count(*)
    FROM users u
    JOIN tenants t ON t.id = u.tenant_id
    WHERE t.public_id = '${tenantPublicId}' AND u.email = '${email}';
  `);

const linkCount = (email: string): string =>
  querySql(`
    SELECT count(*)
    FROM user_identities i
    JOIN users u ON u.id = i.user_id
    WHERE u.email = '${email}' AND i.provider = 'google';
  `);

const signInWithGoogle = async (
  page: Page,
  account: GoogleAccount,
  baseUrl: string = WEB_HOST_SOCIAL_SIGN_IN_BASE_URL
): Promise<void> => {
  await stubGoogleSignIn(page, account);
  await page.goto(`${baseUrl}${hostPath("/login")}`);
  await page.getByRole("button", { name: CONTINUE_WITH_GOOGLE }).click();
};

/** The token of the `pathname` link mailed to `recipient`, opened on this tenant. */
const openMailedLink = async (
  page: Page,
  recipient: string,
  pathname: string
): Promise<void> => {
  const token = tokenFromLink(await waitForMessageTo(recipient), pathname);
  await page.goto(socialUrl(`${pathname}?token=${encodeURIComponent(token)}`));
};

const expectSignedInAs = async (page: Page, name: string): Promise<void> => {
  await openHostUserMenu(page);
  await expect(page.getByRole("menu")).toContainText(name);
  await page.keyboard.press("Escape");
};

test.describe("Sign in with Apple and Google on the public site", () => {
  test.describe.configure({ mode: "serial" });

  test.beforeAll(() => {
    applyScenarioSql(SOCIAL_SIGN_IN_SCENARIO);
  });

  test("offers a button for each provider the tenant enabled, and none elsewhere", async ({
    page,
  }) => {
    await page.goto(socialUrl("/login"));
    await expect(
      page.getByRole("button", { name: CONTINUE_WITH_APPLE })
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: CONTINUE_WITH_GOOGLE })
    ).toBeVisible();

    await page.goto(socialUrl("/signup"));
    await expect(
      page.getByRole("button", { name: CONTINUE_WITH_GOOGLE })
    ).toBeVisible();

    await page.goto(`${WEB_HOST_BASE_URL}${hostPath("/login")}`);
    await expectLoginPage(page);
    await expect(
      page.getByRole("button", { name: CONTINUE_WITH_GOOGLE })
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: CONTINUE_WITH_APPLE })
    ).toHaveCount(0);
  });

  test("creates an account on the first sign-in and finds it again on the next", async ({
    page,
  }) => {
    await signInWithGoogle(page, NEWCOMER);
    await page.waitForURL(socialUrl("/"));
    await expectSignedInAs(page, NEWCOMER.name);

    await signOutHost(page);
    await signInWithGoogle(page, NEWCOMER);
    await page.waitForURL(socialUrl("/"));
    await expectSignedInAs(page, NEWCOMER.name);

    expect(accountCount(SOCIAL_SIGN_IN_TENANT, NEWCOMER.email)).toBe("1");
  });

  test("links the account holding the address, and unlinks it from the security settings", async ({
    page,
  }) => {
    await signInWithGoogle(page, MEMBER_GOOGLE);
    await page.waitForURL(socialUrl("/"));
    await expectSignedInAs(page, SOCIAL_SIGN_IN_MEMBER.name);
    expect(accountCount(SOCIAL_SIGN_IN_TENANT, MEMBER_GOOGLE.email)).toBe("1");

    await page.goto(socialUrl("/settings/security"));
    const linked = page.getByRole("region", { name: "Linked accounts" });
    await expect(linked).toContainText("Google");
    await expect(linked).toContainText(SOCIAL_SIGN_IN_MEMBER.email);

    await linked.getByRole("button", { name: "Unlink Google" }).click();
    await expect(page.getByText("The account was unlinked.")).toBeVisible();
    await expect(
      page.getByRole("region", { name: "Linked accounts" })
    ).toHaveCount(0);
    expect(linkCount(SOCIAL_SIGN_IN_MEMBER.email)).toBe("0");
  });

  test("keeps the only way into an account without a password", async ({
    page,
  }) => {
    await signInWithGoogle(page, NEWCOMER);
    await page.waitForURL(socialUrl("/"));

    await page.goto(socialUrl("/settings/security"));
    const linked = page.getByRole("region", { name: "Linked accounts" });
    await expect(
      linked.getByRole("button", { name: "Unlink Google" })
    ).toBeDisabled();
    await expect(linked).toContainText(
      "Your account has no password, so the last linked account stays linked."
    );
  });

  test("moves an account without a password to another address, and sets its first password", async ({
    page,
  }) => {
    await Promise.all([
      clearMessagesTo(MOVER.email),
      clearMessagesTo(MOVER_NEW_EMAIL),
    ]);
    await signInWithGoogle(page, MOVER);
    await page.waitForURL(socialUrl("/"));

    await page.goto(socialUrl("/settings/security"));
    const emailChange = page.getByRole("region", {
      name: "Change email address",
    });
    await expect(emailChange.getByLabel("Current password")).toHaveCount(0);
    await emailChange.getByLabel("Current email address").fill(MOVER.email);
    await emailChange.getByLabel("New email address").fill(MOVER_NEW_EMAIL);
    await emailChange
      .getByRole("button", { name: "Confirm with Google" })
      .click();
    await page.waitForURL(
      (url) =>
        url.pathname.endsWith("/settings/security") &&
        url.searchParams.get("status") === "success"
    );

    await openMailedLink(page, MOVER.email, "/confirm-email");
    await openMailedLink(page, MOVER_NEW_EMAIL, "/confirm-email");
    await expect(
      page.getByText("Your email address has been changed.")
    ).toBeVisible();
    expect(accountCount(SOCIAL_SIGN_IN_TENANT, MOVER_NEW_EMAIL)).toBe("1");

    // The confirmation the new address was sent is spent, so the next message
    // there is the reset link.
    await clearMessagesTo(MOVER_NEW_EMAIL);
    await page.goto(socialUrl("/settings/security"));
    await page
      .getByRole("region", { name: "Set a password" })
      .getByRole("link", { name: "Request a password reset email" })
      .click();
    await page.waitForURL((url) => url.pathname.endsWith("/reset-password"));
    // The link is a client-side navigation, which keeps the settings screen and
    // its two address fields on the page until the next one renders.
    await page
      .getByRole("textbox", { name: /^Email address/u })
      .fill(MOVER_NEW_EMAIL);
    await page.getByRole("button", { name: "Send reset email" }).click();
    await page.waitForURL(/\/reset-password\/requested\/?$/u);

    await openMailedLink(page, MOVER_NEW_EMAIL, "/confirm-password");
    await page.getByLabel(/^New password\s*\*?$/u).fill(MOVER_PASSWORD);
    await page.getByLabel(/^Confirm new password\s*\*?$/u).fill(MOVER_PASSWORD);
    await page.getByRole("button", { name: "Reset password" }).click();
    await expect(
      page.getByText(
        "Your password has been reset. Sign in with your new password."
      )
    ).toBeVisible();

    await signInAsMember(
      page,
      { email: MOVER_NEW_EMAIL, password: MOVER_PASSWORD },
      "/settings/security",
      WEB_HOST_SOCIAL_SIGN_IN_BASE_URL
    );
    await expect(
      page.getByRole("region", { name: "Change password" })
    ).toBeVisible();
    await expect(
      page
        .getByRole("region", { name: "Change email address" })
        .getByLabel("Current password")
    ).toBeVisible();
  });

  test("keeps the reader signed in when the API cannot verify the fresh sign-in", async ({
    page,
  }) => {
    await signInWithGoogle(page, NEWCOMER);
    await page.waitForURL(socialUrl("/"));
    await stubGoogleSignIn(page, NEWCOMER, {
      audience: "another-client.apps.googleusercontent.com",
    });

    await page.goto(socialUrl("/settings"));
    await page.getByRole("button", { name: "Delete account" }).click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Confirm with Google" })
      .click();

    await page.waitForURL((url) => url.pathname.endsWith("/settings"));
    await expect(
      page.getByText(
        "Could not delete your account. Please check what you entered."
      )
    ).toBeVisible();
    await expectSignedInAs(page, NEWCOMER.name);
    expect(accountCount(SOCIAL_SIGN_IN_TENANT, NEWCOMER.email)).toBe("1");
  });

  test("deletes an account without a password once the reader signs in again", async ({
    page,
  }) => {
    await signInWithGoogle(page, NEWCOMER);
    await page.waitForURL(socialUrl("/"));

    await page.goto(socialUrl("/settings"));
    await page.getByRole("button", { name: "Delete account" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByLabel("Current password")).toHaveCount(0);
    await dialog.getByRole("button", { name: "Confirm with Google" }).click();

    await page.waitForURL((url) => url.pathname.endsWith("/login"));
    expect(accountCount(SOCIAL_SIGN_IN_TENANT, NEWCOMER.email)).toBe("0");
  });

  test("asks for consent to the tenant's terms before creating the account", async ({
    page,
  }) => {
    await signInWithGoogle(
      page,
      CONSENT_NEWCOMER,
      WEB_HOST_SOCIAL_SIGN_IN_CONSENT_BASE_URL
    );
    await page.waitForURL((url) => url.pathname.endsWith("/signup/continue"));
    expect(
      accountCount(SOCIAL_SIGN_IN_CONSENT_TENANT, CONSENT_NEWCOMER.email)
    ).toBe("0");

    await expect(
      page.getByRole("link", { name: SOCIAL_SIGN_IN_TERMS_PAGE.title })
    ).toBeVisible();
    await page
      .getByRole("checkbox", {
        name: "I have read and agree to the following.",
      })
      .check();
    await page.getByRole("button", { name: "Create account" }).click();

    await page.waitForURL(
      `${WEB_HOST_SOCIAL_SIGN_IN_CONSENT_BASE_URL}${hostPath("/")}`
    );
    await expectSignedInAs(page, CONSENT_NEWCOMER.name);
    expect(
      querySql(`
        SELECT c.page_version_id
        FROM user_page_consents c
        JOIN users u ON u.id = c.user_id
        WHERE u.email = '${CONSENT_NEWCOMER.email}';
      `)
    ).toBe(SOCIAL_SIGN_IN_TERMS_PAGE.versionId);
  });
});
