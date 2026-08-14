import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";

import { SEED_MEMBER } from "../src/scenarios/member-announcements";

/**
 * The host inbox (#883) is header chrome plus `/notifications`. Seed data
 * has no inbox rows, so the empty bell and empty list are the path this suite
 * can assert without waiting on #863. `/announcements` stays the delivery list.
 */
const signInAsSeedMember = async (
  page: Page,
  returnTo = "/notifications"
): Promise<void> => {
  await page.goto(`/login?returnTo=${encodeURIComponent(returnTo)}`);
  await page.getByLabel(/メールアドレス/u).fill(SEED_MEMBER.email);
  await page.getByLabel(/パスワード/u).fill(SEED_MEMBER.password);
  await page.getByRole("button", { name: "ログイン" }).click();
  await page.waitForURL((url) => !url.pathname.endsWith("/login"));
};

test.describe("web-host notification bell", () => {
  test("空のベルと通知一覧を出し、お知らせ画面は回帰しない", async ({
    page,
  }) => {
    await signInAsSeedMember(page);

    const bell = page.getByRole("link", { name: "通知、未読はありません" });
    await expect(bell).toBeVisible();
    await expect(bell).toHaveAttribute("href", "/notifications");

    await expect(page).toHaveURL(/\/notifications\/?$/u);
    await expect(
      page.getByRole("heading", { exact: true, level: 1, name: "通知" })
    ).toBeVisible();
    await expect(page.getByText("通知はまだありません。")).toBeVisible();

    await page.goto("/announcements");
    await expect(page).toHaveURL(/\/announcements\/?$/u);
    await expect(
      page.getByRole("heading", { exact: true, level: 1, name: "お知らせ" })
    ).toBeVisible();
    await expect(page.getByText("通知はまだありません。")).toHaveCount(0);
  });

  test("未ログインの /notifications はログインへ送る", async ({ page }) => {
    await page.goto("/notifications");
    await expect(page).toHaveURL(/\/login\?returnTo=/u);
    await expect(
      page.getByRole("link", { name: "通知、未読はありません" })
    ).toHaveCount(0);
  });
});
