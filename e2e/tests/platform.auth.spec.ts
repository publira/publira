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
 * Login / logout / session rejection for web-platform (#67).
 *
 * GET /logout CSRF is `platform.logout.spec.ts`. Role denial (operator vs
 * super admin) is `platform.tenant-ops.spec.ts`. credentials_version bumps use
 * a dedicated platform user so they cannot invalidate those suites mid-run.
 */
test.describe("web-platform auth", () => {
  test("正しい資格情報でテナント一覧へ戻る", async ({ page }) => {
    await signInAsSeedPlatformSuperAdmin(page, "/tenants");

    await expect(page).toHaveURL(/\/tenants\/?$/u);
    await expect(
      page.getByRole("heading", { name: /テナント/u }).first()
    ).toBeVisible();
    expect(await currentSession(page)).toBeTruthy();
  });

  test("誤ったパスワードではログインできず Cookie も出さない", async ({
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

  test("未認証の /tenants は next 付きでログインへ送り、成功後に戻す", async ({
    page,
  }) => {
    await page.goto(platformUrl("/tenants"));

    await expect(page).toHaveURL(/\/login\?next=/u);
    await expect(page).toHaveURL(/next=%2Ftenants/u);
    await fillLoginForm(page, SEED_PLATFORM_SUPER_ADMIN);

    await expect(page).toHaveURL(/\/tenants\/?$/u);
    await expect(
      page.getByRole("heading", { name: /テナント/u }).first()
    ).toBeVisible();
  });

  test("外部 URL の next は捨ててコンソールトップへ送る", async ({ page }) => {
    await page.goto(
      platformUrl(`/login?next=${encodeURIComponent("//evil.example")}`)
    );
    await fillLoginForm(page, SEED_PLATFORM_SUPER_ADMIN);

    await expect(page).toHaveURL(/\/(?:$|\?)/u);
    await expect(
      page.getByRole("heading", { name: "横断オペレーションの基準点" })
    ).toBeVisible();
  });

  test("ログアウトすると Cookie を消しログインへ戻す", async ({ page }) => {
    await signInAsSeedPlatformSuperAdmin(page, "/tenants");
    expect(await currentSession(page)).toBeTruthy();

    await signOutPlatform(page);

    await expectLoginPage(page);
    expect(await currentSession(page)).toBeUndefined();

    await page.goto(platformUrl("/tenants"));
    await expect(page).toHaveURL(/\/login\?next=/u);
  });

  test("Cookie が無い保護ルートはログインへ送る", async ({ page }) => {
    await signInAsSeedPlatformSuperAdmin(page, "/tenants");
    await page.context().clearCookies({ name: PLATFORM_SESSION_COOKIE_NAME });

    await page.goto(platformUrl("/tenants"));
    await expectLoginPage(page);
    await expect(page).not.toHaveURL(/reason=session_revoked/u);
  });

  test("Cookie の期限切れはログインへ送り session_revoked にはしない", async ({
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

  test("期限切れ JWT は再ログイン案内を出す", async ({ page }) => {
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

  test("credentials_version 失効は再ログイン案内を出す", async ({ page }) => {
    applyScenarioSql(AUTH_E2E_SCENARIO);
    await signInAsPlatformOperator(page, SCENARIO_AUTH_PLATFORM, "/tenants");
    await expect(
      page.getByRole("heading", { name: /テナント/u }).first()
    ).toBeVisible();

    bumpPlatformUserCredentialsVersion(SCENARIO_AUTH_PLATFORM.email);

    await page.goto(platformUrl("/audit-logs"));
    await expectSessionRevokedFlash(page);
    expect(await currentSession(page)).toBeUndefined();
  });
});
