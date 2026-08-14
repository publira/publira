import { expect, test } from "@playwright/test";

import { signInAsSeedAdmin } from "../src/admin";
import { WEB_ADMIN_BASE_URL } from "../src/urls";

const adminUrl = (pathname: string): string =>
  `${WEB_ADMIN_BASE_URL}${pathname}`;

/**
 * The admin inbox (#881) is a different screen from announcement delivery.
 * Seed data has no inbox rows, so the empty bell and empty list are the
 * path this suite can assert without waiting on #862.
 */
test.describe("web-admin notification bell", () => {
  test("空のベルと通知一覧を出し、お知らせ画面は回帰しない", async ({
    page,
  }) => {
    await signInAsSeedAdmin(page, "/");

    const bell = page.getByRole("link", { name: "通知、未読はありません" });
    await expect(bell).toBeVisible();
    await expect(bell).toHaveAttribute("href", "/notifications");

    await bell.click();
    await expect(page).toHaveURL(/\/notifications\/?$/u);
    await expect(page.getByRole("heading", { name: "通知" })).toBeVisible();
    await expect(page.getByText("通知はまだありません。")).toBeVisible();
    await expect(
      page.getByRole("link", { name: "お知らせを作成" })
    ).toHaveCount(0);

    await page.goto(adminUrl("/announcements"));
    await expect(page).toHaveURL(/\/announcements\/?$/u);
    await expect(page.getByRole("heading", { name: "お知らせ" })).toBeVisible();
    await expect(
      page.getByRole("link", { name: "お知らせを作成" })
    ).toBeVisible();
    await expect(page.getByText("通知はまだありません。")).toHaveCount(0);
  });
});
