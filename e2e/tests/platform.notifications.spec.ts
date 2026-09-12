import { expect, test } from "@playwright/test";

import { signInAsSeedPlatformSuperAdmin } from "../src/platform";

/**
 * The platform inbox is header chrome plus `/notifications`. Seed data has no
 * inbox rows, so the empty notification menu is the path this suite can assert
 * without waiting on a delivery path that fills the inbox.
 */
test.describe("web-platform notification bell", () => {
  test("opens the empty notification menu and moves to the notification list", async ({
    page,
  }) => {
    await signInAsSeedPlatformSuperAdmin(page, "/");

    const bell = page.getByRole("button", {
      name: "Notifications, none unread",
    });
    await expect(bell).toBeVisible();

    await bell.click();
    const menu = page.getByRole("dialog");
    await expect(
      menu.getByRole("heading", { exact: true, name: "Notifications" })
    ).toBeVisible();
    await expect(menu.getByText("No notifications yet.")).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();
    await expect(bell).toBeFocused();

    await bell.click();
    const more = menu.getByRole("link", { name: "View all" });
    await expect(more).toHaveAttribute("href", "/notifications");
    await Promise.all([page.waitForURL(/\/notifications\/?$/u), more.click()]);
    // Scoped to the page body: the menu titles itself "Notifications" too, and
    // it is still closing its way out of the document as the screen arrives.
    const main = page.getByRole("main");
    await expect(
      main.getByRole("heading", { exact: true, name: "Notifications" })
    ).toBeVisible();
    await expect(main.getByText("No notifications yet.")).toBeVisible();
  });
});
