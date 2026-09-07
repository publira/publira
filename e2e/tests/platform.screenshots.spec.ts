import { expect, test } from "@playwright/test";

import { signInAsSeedPlatformSuperAdmin } from "../src/platform";
import { SEED_TENANT } from "../src/scenarios/multi-tenant";
import { expectScreenshot, SCREENSHOT_VIEWPORTS } from "../src/screenshots";

/**
 * What the operator console looks like, at a phone width and a desktop width.
 *
 * These record the screens rather than assert anything about them; the
 * assertions before each shot only establish that the page finished arriving,
 * since a skeleton photographs as readily as the content that replaces it.
 *
 * Both screens print when something was created — the tenant list in its own
 * column, the dashboard in the recent events it lists — and both list every
 * tenant the platform has. The project therefore runs before the suites that
 * create tenants, against the timestamps
 * `db/seeds/scenarios/160_screenshot_baseline.sql` pins.
 */
test.describe("web-platform screenshots", () => {
  for (const viewport of SCREENSHOT_VIEWPORTS) {
    test.describe(`at ${viewport.label}px`, () => {
      test.beforeEach(async ({ page }) => {
        await page.setViewportSize(viewport);
        await signInAsSeedPlatformSuperAdmin(page, "/");
      });

      test("the dashboard", async ({ page }) => {
        await page.goto("/");

        await expect(
          page.getByRole("heading", {
            level: 1,
            name: "Cross-tenant operations hub",
          })
        ).toBeVisible();
        await expect(page.getByText("Total tenants")).toBeVisible();
        await expect(
          page.getByText("Recent cross-tenant events")
        ).toBeVisible();

        await expectScreenshot(page, viewport, "dashboard");
      });

      test("the tenant list", async ({ page }) => {
        await page.goto("/tenants");

        await expect(
          page.getByRole("heading", { level: 1, name: "Tenants" })
        ).toBeVisible();
        await expect(page.getByText(SEED_TENANT.name).first()).toBeVisible();

        await expectScreenshot(page, viewport, "tenants-list");
      });
    });
  }
});
