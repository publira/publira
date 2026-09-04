import { expect, test } from "@playwright/test";

import { applyScenarioSql } from "../src/db";
import {
  signInAsPlatformOperator,
  signInAsSeedPlatformSuperAdmin,
  signOutPlatform,
} from "../src/platform";
import {
  AUTH_E2E_SCENARIO,
  SCENARIO_AUTH_PLATFORM,
  SEED_PLATFORM_SUPER_ADMIN,
} from "../src/scenarios/auth";
import {
  bumpPlatformUserCredentialsVersion,
  expectLoginPage,
  expectSameOriginPath,
  expectSessionRevokedFlash,
  fillLoginForm,
  LOGIN_FAILED_MESSAGE,
  plantExpiredAccessTokenCookie,
  plantExpiredSessionCookie,
  PLATFORM_SESSION_COOKIE_NAME,
  sessionCookieValue,
} from "../src/session";
import { WEB_PLATFORM_BASE_URL } from "../src/urls";

const platformUrl = (pathname: string): string =>
  `${WEB_PLATFORM_BASE_URL}${pathname}`;

const currentSession = async (
  page: Parameters<typeof signInAsSeedPlatformSuperAdmin>[0]
): Promise<string | undefined> =>
  sessionCookieValue(
    await page.context().cookies(),
    PLATFORM_SESSION_COOKIE_NAME
  );

/**
 * Login / logout / session rejection for web-platform.
 *
 * GET /logout CSRF is `platform.logout.spec.ts`. Role denial (operator vs
 * super admin) is `platform.tenant-ops.spec.ts`. credentials_version bumps use
 * a dedicated platform user so they cannot invalidate those suites mid-run.
 */
test.describe("web-platform auth", () => {
  test("valid credentials return to the tenant list", async ({ page }) => {
    await signInAsSeedPlatformSuperAdmin(page, "/tenants");

    await expect(page).toHaveURL(/\/tenants\/?$/u);
    await expect(
      page.getByRole("heading", { name: /Tenants/u }).first()
    ).toBeVisible();
    expect(await currentSession(page)).toBeTruthy();
  });

  test("a wrong password neither signs in nor issues a cookie", async ({
    page,
  }) => {
    await page.goto(platformUrl("/login?next=%2Ftenants"));
    await fillLoginForm(page, {
      email: SEED_PLATFORM_SUPER_ADMIN.email,
      password: "wrong-password",
    });

    await expectLoginPage(page);
    await expect(page.getByRole("status")).toContainText(LOGIN_FAILED_MESSAGE);
    expect(await currentSession(page)).toBeUndefined();
  });

  test("an unauthenticated /tenants redirects to login with next and comes back after signing in", async ({
    page,
  }) => {
    await page.goto(platformUrl("/tenants"));

    await expect(page).toHaveURL(/\/login\?next=/u);
    await expect(page).toHaveURL(/next=%2Ftenants/u);
    await fillLoginForm(page, SEED_PLATFORM_SUPER_ADMIN);

    await expect(page).toHaveURL(/\/tenants\/?$/u);
    await expect(
      page.getByRole("heading", { name: /Tenants/u }).first()
    ).toBeVisible();
  });

  test("an external next is dropped and the console top is served", async ({
    page,
  }) => {
    await page.goto(
      platformUrl(`/login?next=${encodeURIComponent("//evil.example")}`)
    );
    await fillLoginForm(page, SEED_PLATFORM_SUPER_ADMIN);

    await expectSameOriginPath(page, WEB_PLATFORM_BASE_URL, "/");
    await expect(
      page.getByRole("heading", { name: "Cross-tenant operations hub" })
    ).toBeVisible();
  });

  test("signing out clears the cookie and returns to login", async ({
    page,
  }) => {
    await signInAsSeedPlatformSuperAdmin(page, "/tenants");
    expect(await currentSession(page)).toBeTruthy();

    await signOutPlatform(page);

    await expectLoginPage(page);
    expect(await currentSession(page)).toBeUndefined();

    await page.goto(platformUrl("/tenants"));
    await expect(page).toHaveURL(/\/login\?next=/u);
  });

  test("a protected route without a cookie redirects to login", async ({
    page,
  }) => {
    await signInAsSeedPlatformSuperAdmin(page, "/tenants");
    await page.context().clearCookies({ name: PLATFORM_SESSION_COOKIE_NAME });

    await page.goto(platformUrl("/tenants"));
    await expectLoginPage(page);
    await expect(page).not.toHaveURL(/reason=session_revoked/u);
  });

  test("an expired cookie redirects to login without session_revoked", async ({
    page,
  }) => {
    await signInAsSeedPlatformSuperAdmin(page, "/tenants");
    await plantExpiredSessionCookie(
      page,
      PLATFORM_SESSION_COOKIE_NAME,
      WEB_PLATFORM_BASE_URL
    );

    await page.goto(platformUrl("/tenants"));
    await expectLoginPage(page);
    await expect(page).not.toHaveURL(/reason=session_revoked/u);
    expect(await currentSession(page)).toBeUndefined();
  });

  test("an expired JWT shows the sign-in-again notice", async ({ page }) => {
    await signInAsSeedPlatformSuperAdmin(page, "/tenants");
    await plantExpiredAccessTokenCookie(
      page,
      PLATFORM_SESSION_COOKIE_NAME,
      WEB_PLATFORM_BASE_URL,
      {
        audience: "platform",
        role: "platform_super_admin",
        subject: SEED_PLATFORM_SUPER_ADMIN.publicId,
      }
    );

    await page.goto(platformUrl("/audit-logs"));
    await expectSessionRevokedFlash(page);
    expect(await currentSession(page)).toBeUndefined();
  });

  test("a credentials_version revocation shows the sign-in-again notice", async ({
    page,
  }) => {
    applyScenarioSql(AUTH_E2E_SCENARIO);
    await signInAsPlatformOperator(page, SCENARIO_AUTH_PLATFORM, "/tenants");
    await expect(
      page.getByRole("heading", { name: /Tenants/u }).first()
    ).toBeVisible();

    bumpPlatformUserCredentialsVersion(SCENARIO_AUTH_PLATFORM.email);

    await page.goto(platformUrl("/audit-logs"));
    await expectSessionRevokedFlash(page);
    expect(await currentSession(page)).toBeUndefined();
  });
});
