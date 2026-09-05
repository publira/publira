import { expect, test } from "@playwright/test";

import { signInAsAdmin, signInAsSeedAdmin, signOutAdmin } from "../src/admin";
import { applyScenarioSql } from "../src/db";
import {
  AUTH_E2E_SCENARIO,
  SCENARIO_AUTH_ADMIN,
  SEED_ADMIN,
  SEED_ADMIN_PUBLIC_ID,
  SEED_MEMBER,
  SEED_TENANT_ID,
} from "../src/scenarios/auth";
import {
  ADMIN_SESSION_COOKIE_NAME,
  bumpUserCredentialsVersion,
  expectLoginPage,
  expectSameOriginPath,
  expectSessionRevokedFlash,
  fillLoginForm,
  LOGIN_FAILED_MESSAGE,
  plantExpiredAccessTokenCookie,
  plantExpiredSessionCookie,
  sessionCookieValue,
} from "../src/session";
import { WEB_ADMIN_BASE_URL } from "../src/urls";

const adminUrl = (pathname: string): string =>
  `${WEB_ADMIN_BASE_URL}${pathname}`;

const currentSession = async (
  page: Parameters<typeof signInAsSeedAdmin>[0]
): Promise<string | undefined> =>
  sessionCookieValue(await page.context().cookies(), ADMIN_SESSION_COOKIE_NAME);

/**
 * Login / logout / session rejection for web-admin.
 *
 * GET /logout must stay a 404, so a forced-logout link cannot end a session.
 * Role denial uses the seed member, who can sign in to the console but cannot
 * edit tenant settings. credentials_version bumps use a dedicated scenario
 * admin so they cannot invalidate `admin.publish-flow` /
 * `admin.access-tickets` mid-run.
 */
test.describe("web-admin auth", () => {
  test("valid credentials return to the series list", async ({ page }) => {
    await signInAsSeedAdmin(page, "/series");

    await expect(page).toHaveURL(/\/series\/?$/u);
    await expect(
      page.getByRole("heading", { exact: true, name: "Series" }).first()
    ).toBeVisible();
    expect(await currentSession(page)).toBeTruthy();
  });

  test("a wrong password neither signs in nor issues a cookie", async ({
    page,
  }) => {
    await page.goto(adminUrl("/login?next=%2Fseries"));
    await fillLoginForm(page, {
      email: SEED_ADMIN.email,
      password: "wrong-password",
    });

    await expectLoginPage(page);
    await expect(page.getByRole("status")).toContainText(LOGIN_FAILED_MESSAGE);
    expect(await currentSession(page)).toBeUndefined();
  });

  test("an unauthenticated /series redirects to login with next and comes back after signing in", async ({
    page,
  }) => {
    await page.goto(adminUrl("/series"));

    await expect(page).toHaveURL(/\/login\?next=/u);
    await expect(page).toHaveURL(/next=%2Fseries/u);
    await fillLoginForm(page, SEED_ADMIN);

    await expect(page).toHaveURL(/\/series\/?$/u);
    await expect(
      page.getByRole("heading", { exact: true, name: "Series" }).first()
    ).toBeVisible();
  });

  test("an external next is dropped and the dashboard is served", async ({
    page,
  }) => {
    await page.goto(
      adminUrl(`/login?next=${encodeURIComponent("//evil.example")}`)
    );
    await fillLoginForm(page, SEED_ADMIN);

    await expectSameOriginPath(page, WEB_ADMIN_BASE_URL, "/");
    await expect(
      page.getByRole("heading", { exact: true, name: "Dashboard" })
    ).toBeVisible();
  });

  test("signing out clears the cookie and returns to login", async ({
    page,
  }) => {
    await signInAsSeedAdmin(page, "/series");
    expect(await currentSession(page)).toBeTruthy();

    await signOutAdmin(page);

    await expectLoginPage(page);
    expect(await currentSession(page)).toBeUndefined();

    await page.goto(adminUrl("/series"));
    await expect(page).toHaveURL(/\/login\?next=/u);
  });

  test("a protected route without a cookie redirects to login", async ({
    page,
  }) => {
    await signInAsSeedAdmin(page, "/series");
    await page.context().clearCookies({ name: ADMIN_SESSION_COOKIE_NAME });

    await page.goto(adminUrl("/series"));
    await expectLoginPage(page);
    await expect(page).not.toHaveURL(/reason=session_revoked/u);
  });

  test("an expired cookie redirects to login without session_revoked", async ({
    page,
  }) => {
    await signInAsSeedAdmin(page, "/series");
    await plantExpiredSessionCookie(
      page,
      ADMIN_SESSION_COOKIE_NAME,
      WEB_ADMIN_BASE_URL,
      SEED_TENANT_ID
    );

    await page.goto(adminUrl("/series"));
    await expectLoginPage(page);
    await expect(page).not.toHaveURL(/reason=session_revoked/u);
    expect(await currentSession(page)).toBeUndefined();
  });

  test("an expired JWT shows the sign-in-again notice", async ({ page }) => {
    await signInAsSeedAdmin(page, "/");
    await plantExpiredAccessTokenCookie(
      page,
      ADMIN_SESSION_COOKIE_NAME,
      WEB_ADMIN_BASE_URL,
      {
        audience: "admin",
        role: "tenant_admin",
        subject: SEED_ADMIN_PUBLIC_ID,
        tenantId: SEED_TENANT_ID,
      }
    );

    await page.goto(adminUrl("/series"));
    await expectSessionRevokedFlash(page);
    expect(await currentSession(page)).toBeUndefined();
  });

  test("a credentials_version revocation shows the sign-in-again notice", async ({
    page,
  }) => {
    applyScenarioSql(AUTH_E2E_SCENARIO);
    await signInAsAdmin(page, SCENARIO_AUTH_ADMIN, "/");
    await expect(
      page.getByRole("heading", { exact: true, name: "Dashboard" })
    ).toBeVisible();

    bumpUserCredentialsVersion(SCENARIO_AUTH_ADMIN.email);

    // A route this session has not rendered yet, so `"use cache: private"`
    // cannot serve the pre-bump GetTenant / ListSeries result.
    await page.goto(adminUrl("/series"));
    await expectSessionRevokedFlash(page);
    expect(await currentSession(page)).toBeUndefined();
  });

  test("a member can enter the console but settings stay read-only", async ({
    page,
  }) => {
    await signInAsAdmin(page, SEED_MEMBER, "/settings/email");

    await expect(page).toHaveURL(/\/settings\/email/u);
    await expect(
      page.getByRole("heading", { exact: true, name: "Settings" })
    ).toBeVisible();
    await expect(
      page.getByText(
        "Only a tenant administrator can change this setting. You have read-only access."
      )
    ).toBeVisible();
    await expect(
      page.getByText("You do not have permission to perform this action.")
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  test("a member sees payment settings read-only with a permission error", async ({
    page,
  }) => {
    await signInAsAdmin(page, SEED_MEMBER, "/settings/payment");

    await expect(page).toHaveURL(/\/settings\/payment/u);
    await expect(
      page.getByRole("heading", { exact: true, name: "Settings" })
    ).toBeVisible();
    await expect(page.getByRole("link", { name: "Payments" })).toBeVisible();
    await expect(
      page.getByText(
        "Only a tenant administrator can change this setting. You have read-only access."
      )
    ).toBeVisible();
    await expect(
      page.getByText("You do not have permission to perform this action.")
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Save" })).toBeDisabled();
  });
});

test.describe("admin GET /logout", () => {
  test("an authenticated GET is a 404 and keeps the session", async ({
    page,
  }) => {
    await signInAsSeedAdmin(page, "/series");

    const before = await currentSession(page);
    expect(before).toBeTruthy();

    const response = await page.request.get(adminUrl("/logout"));
    expect(response.status()).toBe(404);
    expect(response.headers()["set-cookie"] ?? "").not.toContain(
      ADMIN_SESSION_COOKIE_NAME
    );

    expect(await currentSession(page)).toBe(before);

    await page.goto(adminUrl("/series"));
    await expect(
      page.getByRole("heading", { exact: true, name: "Series" }).first()
    ).toBeVisible();
  });

  test("an unauthenticated GET is a 404 and issues no cookie", async ({
    request,
  }) => {
    const response = await request.get(adminUrl("/logout"));
    expect(response.status()).toBe(404);
    expect(response.headers()["set-cookie"] ?? "").not.toContain(
      ADMIN_SESSION_COOKIE_NAME
    );
  });
});
