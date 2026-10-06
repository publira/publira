import { expect, test } from "@playwright/test";

import { signInAsSeedAdmin } from "../src/admin";
import { expectTapTargets, TABLET_HEIGHT, TABLET_WIDTHS } from "../src/tablet";

/**
 * The tenant console on a tablet, driven by touch: the project runs these
 * under an iPad descriptor, so the pointer is coarse and nothing can be
 * hovered.
 */
test.describe("web-admin on a tablet", () => {
  test.beforeEach(async ({ page }) => {
    await signInAsSeedAdmin(page, "/series");
  });

  for (const width of TABLET_WIDTHS) {
    test(`keeps the sidebar at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ height: TABLET_HEIGHT, width });
      const sidebar = page.getByRole("complementary");

      await expect(
        sidebar.getByRole("link", { exact: true, name: "Series" })
      ).toBeVisible();
      // The floating menu button is a phone's way to the same navigation.
      await expect(
        page.getByRole("button", { name: "Open navigation" })
      ).toBeHidden();
      await expectTapTargets(sidebar);
    });
  }

  test("opens a series from the table and the account menu on a tap", async ({
    page,
  }) => {
    await page.getByRole("button", { name: /^Account menu/u }).tap();
    await expect(
      page.getByRole("menuitem", { name: /Sign out/u })
    ).toBeVisible();
    await page.keyboard.press("Escape");

    await page.getByRole("table").getByRole("link").first().tap();

    await expect(page).toHaveURL(/\/series\/[0-9A-Za-z]+$/u);
  });
});
