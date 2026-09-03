import { expect, test } from "@playwright/test";

import { signInAsNotificationInboxAdmin } from "../src/admin";
import { applyScenarioSql } from "../src/db";
import { NOTIFICATION_INBOX_SCENARIO } from "../src/scenarios/notification-inbox";
import { WEB_ADMIN_NOTIFICATION_INBOX_BASE_URL } from "../src/urls";

const inboxUrl = (pathname: string): string =>
  `${WEB_ADMIN_NOTIFICATION_INBOX_BASE_URL}${pathname}`;

/**
 * The admin inbox is a different screen from announcement delivery. There are
 * no inbox rows to assert against yet, so the empty bell menu and empty list
 * are the path this suite can take without waiting on a delivery path that
 * fills the inbox.
 *
 * The admin is the inbox tenant's own: publishing an episode notifies
 * every admin of that episode's tenant, so the dev seed admin's bell stops
 * being empty the moment `admin.publish-flow` runs beside this file.
 */
test.describe("web-admin notification bell", () => {
  test.beforeAll(() => {
    applyScenarioSql(NOTIFICATION_INBOX_SCENARIO);
  });

  test("shows the empty bell menu and notification list, leaving the announcements screen intact", async ({
    page,
  }) => {
    await signInAsNotificationInboxAdmin(page, "/");

    const bell = page.getByRole("button", {
      name: "通知、未読はありません",
    });
    await expect(bell).toBeVisible();
    await expect(bell).toHaveAttribute("aria-expanded", "false");

    await bell.click();
    const menu = page.getByRole("dialog", { name: "通知" });
    await expect(menu).toBeVisible();
    await expect(bell).toHaveAttribute("aria-expanded", "true");
    await expect(page).toHaveURL(/\/$/u);
    await expect(menu.getByText("通知はまだありません。")).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();
    await expect(bell).toBeFocused();

    await bell.click();
    const more = menu.getByRole("link", { name: "もっと見る" });
    await expect(more).toHaveAttribute("href", "/notifications");
    await Promise.all([page.waitForURL(/\/notifications\/?$/u), more.click()]);
    await expect(page).toHaveURL(/\/notifications\/?$/u);
    await expect(page.getByRole("heading", { name: "通知" })).toBeVisible();
    await expect(page.getByText("通知はまだありません。")).toBeVisible();
    await expect(
      page.getByRole("link", { name: "お知らせを作成" })
    ).toHaveCount(0);

    await page.goto(inboxUrl("/announcements"));
    await expect(page).toHaveURL(/\/announcements\/?$/u);
    await expect(page.getByRole("heading", { name: "お知らせ" })).toBeVisible();
    await expect(
      page.getByRole("link", { name: "お知らせを作成" })
    ).toBeVisible();
    await expect(page.getByText("通知はまだありません。")).toHaveCount(0);
  });
});
