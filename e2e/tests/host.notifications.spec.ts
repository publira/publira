import { expect, test } from "@playwright/test";

import { applyScenarioSql } from "../src/db";
import { signInAsNotificationInboxMember } from "../src/host";
import { NOTIFICATION_INBOX_SCENARIO } from "../src/scenarios/notification-inbox";
import { hostPath, WEB_HOST_NOTIFICATION_INBOX_BASE_URL } from "../src/urls";

const inboxUrl = (pathname: string): string =>
  `${WEB_HOST_NOTIFICATION_INBOX_BASE_URL}${hostPath(pathname)}`;

/**
 * The host inbox is header chrome plus `/notifications`. There are no inbox
 * rows to assert against yet, so the empty bell and empty list are the path
 * this suite can take without waiting on a delivery path that fills the inbox.
 * `/announcements` stays the delivery list.
 *
 * The member is the inbox tenant's own: publishing an episode notifies
 * every member and admin of that episode's tenant, so the dev seed member's
 * bell stops being empty the moment `admin.publish-flow` runs beside this file.
 */

test.describe("web-host notification bell", () => {
  test.beforeAll(() => {
    applyScenarioSql(NOTIFICATION_INBOX_SCENARIO);
  });

  test("shows the empty bell menu and notification list, leaving the announcements screen intact", async ({
    page,
  }) => {
    await signInAsNotificationInboxMember(page, "/notifications");

    const bell = page.getByRole("button", { name: "通知、未読はありません" });
    await expect(bell).toBeVisible();
    await bell.click();

    const menu = page.getByRole("dialog");
    await expect(menu.getByText("通知一覧")).toBeVisible();
    await expect(menu.getByText("通知はまだありません。")).toBeVisible();
    await menu.getByRole("link", { name: "もっと見る" }).click();

    await expect(page).toHaveURL(/\/notifications\/?$/u);
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(
      page.getByRole("heading", { exact: true, level: 1, name: "通知" })
    ).toBeVisible();
    await expect(
      page.getByRole("main").getByText("通知はまだありません。")
    ).toBeVisible();

    await page.goto(inboxUrl("/announcements"));
    await expect(page).toHaveURL(/\/announcements\/?$/u);
    await expect(
      page.getByRole("heading", { exact: true, level: 1, name: "お知らせ" })
    ).toBeVisible();
    await expect(page.getByText("通知はまだありません。")).toHaveCount(0);
  });

  test("/notifications redirects to login while signed out", async ({
    page,
  }) => {
    await page.goto(inboxUrl("/notifications"));
    await expect(page).toHaveURL(/\/login\?returnTo=/u);
    await expect(
      page.getByRole("link", { name: "通知、未読はありません" })
    ).toHaveCount(0);
  });
});
