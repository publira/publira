import { expect, test } from "@playwright/test";

import { signInAsSeedPlatformSuperAdmin } from "../src/platform";

/**
 * The platform inbox (#882) is header chrome plus `/notifications`. Seed data
 * has no inbox rows, so the empty notification menu is the path this suite
 * can assert without waiting on #861.
 */
test.describe("web-platform notification bell", () => {
  test("空の通知メニューを開き、通知一覧へ移動する", async ({ page }) => {
    await signInAsSeedPlatformSuperAdmin(page, "/");

    const bell = page.getByRole("button", {
      name: "通知、未読はありません",
    });
    await expect(bell).toBeVisible();

    await bell.click();
    const menu = page.getByRole("dialog");
    await expect(menu.getByRole("heading", { name: "通知" })).toBeVisible();
    await expect(menu.getByText("通知はまだありません。")).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();
    await expect(bell).toBeFocused();

    await bell.click();
    const more = menu.getByRole("link", { name: "もっと見る" });
    await expect(more).toHaveAttribute("href", "/notifications");
    await Promise.all([page.waitForURL(/\/notifications\/?$/u), more.click()]);
    await expect(page.getByRole("heading", { name: "通知" })).toBeVisible();
    await expect(page.getByText("通知はまだありません。")).toBeVisible();
  });
});
