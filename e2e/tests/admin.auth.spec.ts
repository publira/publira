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
 * Login / logout / session rejection for web-admin (#67).
 *
 * GET /logout must stay a 404 (forced-logout CSRF, #655). Role denial uses the
 * seed member, who can sign in to the console but cannot edit tenant settings.
 * credentials_version bumps use a dedicated scenario admin so they cannot
 * invalidate `admin.publish-flow` / `admin.access-tickets` mid-run.
 */
test.describe("web-admin auth", () => {
  test("正しい資格情報でシリーズ一覧へ戻る", async ({ page }) => {
    await signInAsSeedAdmin(page, "/series");

    await expect(page).toHaveURL(/\/series\/?$/u);
    await expect(
      page.getByRole("heading", { name: "シリーズ" }).first()
    ).toBeVisible();
    expect(await currentSession(page)).toBeTruthy();
  });

  test("誤ったパスワードではログインできず Cookie も出さない", async ({
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

  test("未認証の /series は next 付きでログインへ送り、成功後に戻す", async ({
    page,
  }) => {
    await page.goto(adminUrl("/series"));

    await expect(page).toHaveURL(/\/login\?next=/u);
    await expect(page).toHaveURL(/next=%2Fseries/u);
    await fillLoginForm(page, SEED_ADMIN);

    await expect(page).toHaveURL(/\/series\/?$/u);
    await expect(
      page.getByRole("heading", { name: "シリーズ" }).first()
    ).toBeVisible();
  });

  test("外部 URL の next は捨ててダッシュボードへ送る", async ({ page }) => {
    await page.goto(
      adminUrl(`/login?next=${encodeURIComponent("//evil.example")}`)
    );
    await fillLoginForm(page, SEED_ADMIN);

    await expectSameOriginPath(page, WEB_ADMIN_BASE_URL, "/");
    await expect(
      page.getByRole("heading", { name: "ダッシュボード" })
    ).toBeVisible();
  });

  test("ログアウトすると Cookie を消しログインへ戻す", async ({ page }) => {
    await signInAsSeedAdmin(page, "/series");
    expect(await currentSession(page)).toBeTruthy();

    await signOutAdmin(page);

    await expectLoginPage(page);
    expect(await currentSession(page)).toBeUndefined();

    await page.goto(adminUrl("/series"));
    await expect(page).toHaveURL(/\/login\?next=/u);
  });

  test("Cookie が無い保護ルートはログインへ送る", async ({ page }) => {
    await signInAsSeedAdmin(page, "/series");
    await page.context().clearCookies({ name: ADMIN_SESSION_COOKIE_NAME });

    await page.goto(adminUrl("/series"));
    await expectLoginPage(page);
    await expect(page).not.toHaveURL(/reason=session_revoked/u);
  });

  test("Cookie の期限切れはログインへ送り session_revoked にはしない", async ({
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

  test("期限切れ JWT は再ログイン案内を出す", async ({ page }) => {
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

  test("credentials_version 失効は再ログイン案内を出す", async ({ page }) => {
    applyScenarioSql(AUTH_E2E_SCENARIO);
    await signInAsAdmin(page, SCENARIO_AUTH_ADMIN, "/");
    await expect(
      page.getByRole("heading", { name: "ダッシュボード" })
    ).toBeVisible();

    bumpUserCredentialsVersion(SCENARIO_AUTH_ADMIN.email);

    // A route this session has not rendered yet, so `"use cache: private"`
    // cannot serve the pre-bump GetTenant / ListSeries result.
    await page.goto(adminUrl("/series"));
    await expectSessionRevokedFlash(page);
    expect(await currentSession(page)).toBeUndefined();
  });

  test("会員はコンソールに入れるが設定は閲覧専用になる", async ({ page }) => {
    await signInAsAdmin(page, SEED_MEMBER, "/settings/email");

    await expect(page).toHaveURL(/\/settings\/email/u);
    await expect(page.getByRole("heading", { name: "設定" })).toBeVisible();
    await expect(
      page.getByText(
        "この設定はテナント管理者のみ編集できます。現在は閲覧専用です。"
      )
    ).toBeVisible();
    await expect(
      page.getByText("この操作を行う権限がありません。")
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "保存" })).toBeDisabled();
  });

  test("会員は決済設定を閲覧専用で権限エラーを見る", async ({ page }) => {
    await signInAsAdmin(page, SEED_MEMBER, "/settings/payment");

    await expect(page).toHaveURL(/\/settings\/payment/u);
    await expect(page.getByRole("heading", { name: "設定" })).toBeVisible();
    await expect(page.getByRole("link", { name: "決済" })).toBeVisible();
    await expect(
      page.getByText(
        "この設定はテナント管理者のみ編集できます。現在は閲覧専用です。"
      )
    ).toBeVisible();
    await expect(
      page.getByText("この操作を行う権限がありません。")
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "保存" })).toBeDisabled();
  });
});

test.describe("admin GET /logout", () => {
  test("認証済み GET は 404 でセッションを維持する", async ({ page }) => {
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
      page.getByRole("heading", { name: "シリーズ" }).first()
    ).toBeVisible();
  });

  test("未認証 GET は 404 で Cookie を発行しない", async ({ request }) => {
    const response = await request.get(adminUrl("/logout"));
    expect(response.status()).toBe(404);
    expect(response.headers()["set-cookie"] ?? "").not.toContain(
      ADMIN_SESSION_COOKIE_NAME
    );
  });
});
