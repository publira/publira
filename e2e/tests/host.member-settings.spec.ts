import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";

import { applyScenarioSql, querySql } from "../src/db";
import { signInAsMember } from "../src/host";
import {
  MEMBER_SETTINGS_MEMBER,
  MEMBER_SETTINGS_NEW_EMAIL,
  MEMBER_SETTINGS_SCENARIO,
  MEMBER_SETTINGS_SERIES,
} from "../src/scenarios/member-settings";
import { hostPath, WEB_HOST_BASE_URL } from "../src/urls";

const hostUrl = (pathname: string): string =>
  `${WEB_HOST_BASE_URL}${hostPath(pathname)}`;

const RENAMED_DISPLAY_NAME = "Renamed Settings Member";

/** Every screen the member area keeps behind a session. */
const MEMBER_PATHS = [
  "/my",
  "/settings",
  "/settings/follows",
  "/settings/notifications",
  "/settings/security",
] as const;

const signIn = (page: Page, returnTo: string): Promise<void> =>
  signInAsMember(page, MEMBER_SETTINGS_MEMBER, returnTo);

const memberField = (column: "email" | "name"): string =>
  querySql(
    `SELECT ${column} FROM users WHERE public_id = '${MEMBER_SETTINGS_MEMBER.publicId}';`
  );

/**
 * Every `/settings` Server Action reports itself by redirecting back with
 * `status` and `message` in the query. The rendered flash is not asserted:
 * `settings/layout.tsx` draws it from a `searchParams` prop the App Router
 * never hands a layout, so nothing reaches the screen — see
 * https://github.com/publira/publira/issues/1489.
 */
const expectFlashRedirect = (
  page: Page,
  status: "error" | "success"
): Promise<void> =>
  page.waitForURL(new RegExp(`[?&]status=${status}(?:&|$)`, "u"));

const emailChangeTokenCount = (): string =>
  querySql(`
    SELECT COUNT(*)
    FROM user_email_change_tokens t
    JOIN users u ON u.id = t.user_id
    WHERE u.public_id = '${MEMBER_SETTINGS_MEMBER.publicId}';
  `);

/**
 * The member area: My Page and the four `/settings` tabs.
 *
 * Every test here rewrites the account it signs in as — the display name, the
 * notification preference, the follow list — so the suite owns a member no
 * other spec signs in as, and re-applies its scenario afterwards to put the
 * starting values back. `mode: "serial"` stops a failed write from being read
 * back as a pass by the test after it.
 *
 * `/settings/security` requests an email change rather than a password change.
 * What is asserted here is the gate in front of the send: a wrong current
 * password is refused, the address stays put, and no change token is left
 * behind. The round trip a valid request starts — the two confirmation links
 * and the address the account ends up signing in with — belongs to
 * `host.email-change.spec.ts`, which owns an account of its own to move.
 */
test.describe("web-host member settings", () => {
  test.describe.configure({ mode: "serial" });

  test.beforeAll(() => {
    applyScenarioSql(MEMBER_SETTINGS_SCENARIO);
  });

  test.afterAll(() => {
    applyScenarioSql(MEMBER_SETTINGS_SCENARIO);
  });

  test("My Page shows the signed-in reader's own profile and subscription state", async ({
    page,
  }) => {
    await signIn(page, "/my");

    await expect(
      page.getByRole("heading", { level: 1, name: "マイページ" })
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "プロフィール" })
    ).toBeVisible();
    await expect(page.getByText(MEMBER_SETTINGS_MEMBER.name)).toBeVisible();
    await expect(page.getByText(MEMBER_SETTINGS_MEMBER.publicId)).toBeVisible();
    await expect(page.getByText("購読中", { exact: true })).toBeVisible();
  });

  test("the basic settings screen saves a display name that survives a reload", async ({
    page,
  }) => {
    await signIn(page, "/settings");

    const nameField = page.getByLabel("表示名");
    await expect(nameField).toHaveValue(MEMBER_SETTINGS_MEMBER.name);
    await nameField.fill(RENAMED_DISPLAY_NAME);
    await page.getByRole("button", { name: "保存" }).click();

    await expectFlashRedirect(page, "success");

    await page.goto(hostUrl("/settings"));
    await expect(page.getByLabel("表示名")).toHaveValue(RENAMED_DISPLAY_NAME);
    expect(memberField("name")).toBe(RENAMED_DISPLAY_NAME);

    await page.goto(hostUrl("/my"));
    await expect(page.getByText(RENAMED_DISPLAY_NAME)).toBeVisible();
  });

  test("the notification screen turns email notifications off and keeps them off", async ({
    page,
  }) => {
    await signIn(page, "/settings/notifications");

    const emailNotifications = page.getByRole("checkbox");
    await expect(emailNotifications).toBeChecked();
    await emailNotifications.uncheck();
    await page.getByRole("button", { name: "保存" }).click();

    await expectFlashRedirect(page, "success");

    await page.goto(hostUrl("/settings/notifications"));
    await expect(page.getByRole("checkbox")).not.toBeChecked();

    await page.goto(hostUrl("/my"));
    await expect(page.getByText("停止中", { exact: true })).toBeVisible();
  });

  test("the security screen refuses an email change whose current password is wrong", async ({
    page,
  }) => {
    await signIn(page, "/settings/security");

    await expect(
      page.getByRole("heading", { name: "メールアドレス変更" })
    ).toBeVisible();
    await page
      .getByLabel("現在のメールアドレス")
      .fill(MEMBER_SETTINGS_MEMBER.email);
    await page
      .getByLabel("新しいメールアドレス")
      .fill(MEMBER_SETTINGS_NEW_EMAIL);
    await page.getByLabel("現在のパスワード").fill("wrong-password");
    await page.getByRole("button", { name: "確認メールを送信" }).click();

    await expectFlashRedirect(page, "error");
    await expect(page).toHaveURL(/\/settings\/security/u);
    expect(memberField("email")).toBe(MEMBER_SETTINGS_MEMBER.email);
    expect(emailChangeTokenCount()).toBe("0");
  });

  test("following a series from its page lists it, and unfollowing clears both", async ({
    page,
  }) => {
    const seriesPath = `/series/${MEMBER_SETTINGS_SERIES.publicId}`;
    const followLabel = `「${MEMBER_SETTINGS_SERIES.title}」をフォローする`;
    const unfollowLabel = `「${MEMBER_SETTINGS_SERIES.title}」のフォローを解除する`;
    await signIn(page, seriesPath);

    await page.getByRole("button", { name: followLabel }).click();
    await expect(page.getByText("フォローしました。")).toBeVisible();

    await page.goto(hostUrl("/settings/follows"));
    const entry = page.getByRole("article").filter({
      has: page.getByRole("link", { name: MEMBER_SETTINGS_SERIES.title }),
    });
    await expect(entry).toBeVisible();
    await expect(entry.getByText("作品")).toBeVisible();

    // The Action refreshes the follow island, so the entry — and the button's
    // own success message with it — is gone by the time the list re-renders.
    await entry.getByRole("button", { name: unfollowLabel }).click();
    await expect(entry).toHaveCount(0);
    await expect(
      page.getByText("フォロー中の作品・著者はありません。")
    ).toBeVisible();

    await page.goto(hostUrl("/settings/follows"));
    await expect(
      page.getByRole("link", { name: MEMBER_SETTINGS_SERIES.title })
    ).toHaveCount(0);

    await page.goto(hostUrl(seriesPath));
    await expect(page.getByRole("button", { name: followLabel })).toBeVisible();
  });

  for (const memberPath of MEMBER_PATHS) {
    test(`${memberPath} redirects to login while signed out and returns after signing in`, async ({
      page,
    }) => {
      await page.goto(hostUrl(memberPath));

      await expect(page).toHaveURL(
        new RegExp(`/login\\?returnTo=${encodeURIComponent(memberPath)}$`, "u")
      );

      await signIn(page, memberPath);
      await expect(page).toHaveURL(new RegExp(`${memberPath}/?$`, "u"));
    });
  }
});
