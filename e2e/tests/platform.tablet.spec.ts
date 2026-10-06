import { expect, test } from "@playwright/test";

import { signInAsSeedPlatformSuperAdmin } from "../src/platform";
import { SEED_TENANT } from "../src/scenarios/multi-tenant";
import { expectTapTargets, TABLET_HEIGHT, TABLET_WIDTHS } from "../src/tablet";

/**
 * The platform console on a tablet, driven by touch: the project runs these
 * under an iPad descriptor, so the pointer is coarse and nothing can be
 * hovered.
 */
test.describe("web-platform on a tablet", () => {
  test.beforeEach(async ({ page }) => {
    await signInAsSeedPlatformSuperAdmin(page, "/tenants");
  });

  for (const width of TABLET_WIDTHS) {
    test(`keeps the sidebar at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ height: TABLET_HEIGHT, width });
      const sidebar = page.getByRole("complementary");

      await expect(
        sidebar.getByRole("link", { exact: true, name: "Tenants" })
      ).toBeVisible();
      // The floating menu button is a phone's way to the same navigation.
      await expect(
        page.getByRole("button", { name: "Open navigation" })
      ).toBeHidden();
      await expectTapTargets(sidebar);
    });
  }

  test("opens a tenant from the table and the account menu on a tap", async ({
    page,
  }) => {
    await page.getByRole("button", { name: /^Account menu/u }).tap();
    await expect(
      page.getByRole("menuitem", { name: /Sign out/u })
    ).toBeVisible();
    await page.keyboard.press("Escape");

    await page
      .getByRole("row", { name: new RegExp(SEED_TENANT.name, "u") })
      .getByRole("link", { name: "Details" })
      .tap();

    await expect(page).toHaveURL(
      new RegExp(`/tenants/${SEED_TENANT.publicId}$`, "u")
    );
  });
});
