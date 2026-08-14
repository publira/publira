import { expect, test } from "@playwright/test";

import { signInAsSeedPlatformSuperAdmin } from "../src/platform";

/**
 * The platform inbox (#882) is header chrome plus `/notifications`. Seed data
 * has no inbox rows, so the empty bell and empty list are the path this suite
 * can assert without waiting on #861.
 */
test.describe("web-platform notification bell", () => {
  test("空のベルと通知一覧を出す", async ({ page }) => {
    await signInAsSeedPlatformSuperAdmin(page, "/");

    const bell = page.getByRole("link", { name: "通知、未読はありません" });
    await expect(bell).toBeVisible();
    await expect(bell).toHaveAttribute("href", "/notifications");

    await bell.click();
    await expect(page).toHaveURL(/\/notifications\/?$/u);
    await expect(page.getByRole("heading", { name: "通知" })).toBeVisible();
    await expect(page.getByText("通知はまだありません。")).toBeVisible();
  });
});
