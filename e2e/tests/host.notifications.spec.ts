import { expect, test } from "@playwright/test";

import { signInAsSeedMember } from "../src/host";
import { hostPath } from "../src/urls";

/**
 * The host inbox (#883) is header chrome plus `/notifications`. Seed data
 * has no inbox rows, so the empty bell and empty list are the path this suite
 * can assert without waiting on #863. `/announcements` stays the delivery list.
 */

test.describe("web-host notification bell", () => {
  test("空のベルのメニューと通知一覧を出し、お知らせ画面は回帰しない", async ({
    page,
  }) => {
    await signInAsSeedMember(page, "/notifications");

    const bell = page.getByRole("button", { name: "通知、未読はありません" });
    await expect(bell).toBeVisible();
    await bell.click();

    const menu = page.getByRole("dialog");
    await expect(menu.getByText("通知一覧")).toBeVisible();
    await expect(menu.getByText("通知はまだありません。")).toBeVisible();
    await menu.getByRole("link", { name: "もっと見る" }).click();

    await expect(page).toHaveURL(/\/notifications\/?$/u);
    await expect(
      page.getByRole("heading", { exact: true, level: 1, name: "通知" })
    ).toBeVisible();
    await expect(page.getByText("通知はまだありません。")).toBeVisible();

    await page.goto(hostPath("/announcements"));
    await expect(page).toHaveURL(/\/announcements\/?$/u);
    await expect(
      page.getByRole("heading", { exact: true, level: 1, name: "お知らせ" })
    ).toBeVisible();
    await expect(page.getByText("通知はまだありません。")).toHaveCount(0);
  });

  test("未ログインの /notifications はログインへ送る", async ({ page }) => {
    await page.goto(hostPath("/notifications"));
    await expect(page).toHaveURL(/\/login\?returnTo=/u);
    await expect(
      page.getByRole("link", { name: "通知、未読はありません" })
    ).toHaveCount(0);
  });
});
