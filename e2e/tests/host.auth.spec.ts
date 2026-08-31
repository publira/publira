import { expect, test } from "@playwright/test";

import { applyScenarioSql } from "../src/db";
import { signInAsMember, signInAsSeedMember, signOutHost } from "../src/host";
import {
  AUTH_E2E_SCENARIO,
  SCENARIO_AUTH_MEMBER,
  SEED_MEMBER,
  SEED_MEMBER_PUBLIC_ID,
  SEED_TENANT_ID,
} from "../src/scenarios/auth";
import {
  bumpUserCredentialsVersion,
  expectLoginPage,
  expectSameOriginPath,
  expectSessionRevokedFlash,
  fillLoginForm,
  HOST_SESSION_COOKIE_NAME,
  LOGIN_FAILED_MESSAGE,
  plantExpiredAccessTokenCookie,
  plantExpiredSessionCookie,
  sessionCookieValue,
} from "../src/session";
import { hostPath, WEB_HOST_BASE_URL } from "../src/urls";

const hostUrl = (pathname: string): string =>
  `${WEB_HOST_BASE_URL}${hostPath(pathname)}`;

const currentSession = async (
  page: Parameters<typeof signInAsSeedMember>[0]
): Promise<string | undefined> =>
  sessionCookieValue(await page.context().cookies(), HOST_SESSION_COOKIE_NAME);

/**
 * Login / logout / member-guard / session rejection for web-host (#67).
 *
 * Catalog stays public. `/my`, `/announcements`, `/notifications`, and
 * `/settings` are the member gate. GET /logout is a published-page slug, not a
 * logout, so it must leave the session alone. credentials_version bumps use a
 * dedicated member so they cannot invalidate `host.notifications` mid-run.
 */
test.describe("web-host auth", () => {
  test("valid credentials return to My Page", async ({ page }) => {
    await signInAsSeedMember(page, "/my");

    await expect(page).toHaveURL(/\/my\/?$/u);
    await expect(
      page.getByRole("heading", { name: "プロフィール" })
    ).toBeVisible();
    expect(await currentSession(page)).toBeTruthy();
  });

  test("a wrong password neither signs in nor issues a cookie", async ({
    page,
  }) => {
    await page.goto(hostUrl("/login?returnTo=%2Fmy"));
    await fillLoginForm(page, {
      email: SEED_MEMBER.email,
      password: "wrong-password",
    });

    await expectLoginPage(page);
    await expect(page.getByRole("status")).toContainText(LOGIN_FAILED_MESSAGE);
    expect(await currentSession(page)).toBeUndefined();
  });

  test("an unauthenticated member page sends to login with returnTo and comes back on success", async ({
    page,
  }) => {
    await page.goto(hostUrl("/announcements"));

    await expect(page).toHaveURL(/\/login\?returnTo=/u);
    await expect(page).toHaveURL(/returnTo=%2Fannouncements/u);
    await fillLoginForm(page, SEED_MEMBER);

    await expect(page).toHaveURL(/\/announcements\/?$/u);
    await expect(
      page.getByRole("heading", { exact: true, level: 1, name: "お知らせ" })
    ).toBeVisible();
  });

  test("the catalog top is readable without signing in", async ({ page }) => {
    await page.goto(hostUrl("/"));

    await expect(page).not.toHaveURL(/\/login/u);
    await expect(page.getByRole("link", { name: "ログイン" })).toBeVisible();
    expect(await currentSession(page)).toBeUndefined();
  });

  test("an external returnTo is dropped and the site top is served", async ({
    page,
  }) => {
    await page.goto(
      hostUrl(`/login?returnTo=${encodeURIComponent("//evil.example")}`)
    );
    await fillLoginForm(page, SEED_MEMBER);

    await expectSameOriginPath(page, WEB_HOST_BASE_URL, hostPath("/"));
  });

  test("opening /login while signed in sends to My Page", async ({ page }) => {
    await signInAsSeedMember(page, "/my");
    await page.goto(hostUrl("/login?returnTo=%2Fannouncements"));

    await expect(page).toHaveURL(/\/my\/?$/u);
  });

  test("signing out clears the cookie and returns to login", async ({
    page,
  }) => {
    await signInAsSeedMember(page, "/my");
    expect(await currentSession(page)).toBeTruthy();

    await signOutHost(page);

    await expectLoginPage(page);
    expect(await currentSession(page)).toBeUndefined();

    await page.goto(hostUrl("/announcements"));
    await expect(page).toHaveURL(/\/login\?returnTo=/u);
  });

  test("a member page without a cookie sends to login", async ({ page }) => {
    await signInAsSeedMember(page, "/my");
    await page.context().clearCookies({ name: HOST_SESSION_COOKIE_NAME });

    await page.goto(hostUrl("/my"));
    await expectLoginPage(page);
    await expect(page).not.toHaveURL(/reason=session_revoked/u);
  });

  test("an expired cookie sends to login without session_revoked", async ({
    page,
  }) => {
    await signInAsSeedMember(page, "/my");
    await plantExpiredSessionCookie(
      page,
      HOST_SESSION_COOKIE_NAME,
      WEB_HOST_BASE_URL,
      SEED_TENANT_ID
    );

    await page.goto(hostUrl("/my"));
    await expectLoginPage(page);
    await expect(page).not.toHaveURL(/reason=session_revoked/u);
    expect(await currentSession(page)).toBeUndefined();
  });

  test("an expired JWT shows the sign-in-again notice", async ({ page }) => {
    await signInAsSeedMember(page, "/my");
    await plantExpiredAccessTokenCookie(
      page,
      HOST_SESSION_COOKIE_NAME,
      WEB_HOST_BASE_URL,
      {
        audience: "public",
        subject: SEED_MEMBER_PUBLIC_ID,
        tenantId: SEED_TENANT_ID,
      }
    );

    // `/settings` calls GetMe through `withPublicSessionReauth`. `/announcements`
    // caches the RPC error inside `"use cache: private"` and rethrows it as an
    // unclassified digest in the standalone server, so it never reaches login.
    await page.goto(hostUrl("/settings"));
    await expectSessionRevokedFlash(page);
    expect(await currentSession(page)).toBeUndefined();
  });

  test("a credentials_version revocation shows the sign-in-again notice", async ({
    page,
  }) => {
    applyScenarioSql(AUTH_E2E_SCENARIO);
    await signInAsMember(page, SCENARIO_AUTH_MEMBER, "/my");
    await expect(
      page.getByRole("heading", { name: "プロフィール" })
    ).toBeVisible();

    bumpUserCredentialsVersion(SCENARIO_AUTH_MEMBER.email);

    await page.goto(hostUrl("/settings"));
    await expectSessionRevokedFlash(page);
    expect(await currentSession(page)).toBeUndefined();
  });

  test("GET /logout keeps the session instead of signing out", async ({
    page,
  }) => {
    await signInAsSeedMember(page, "/my");

    const before = await currentSession(page);
    expect(before).toBeTruthy();

    const response = await page.request.get(hostUrl("/logout"));
    expect(response.headers()["set-cookie"] ?? "").not.toContain(
      HOST_SESSION_COOKIE_NAME
    );
    expect(await currentSession(page)).toBe(before);

    await page.goto(hostUrl("/my"));
    await expect(
      page.getByRole("heading", { name: "プロフィール" })
    ).toBeVisible();
  });
});
