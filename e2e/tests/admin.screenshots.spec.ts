import { expect, test } from "@playwright/test";

import { signInAsSeedAdmin } from "../src/admin";
import { SEED_TENANT } from "../src/scenarios/multi-tenant";
import { expectScreenshot, SCREENSHOT_VIEWPORTS } from "../src/screenshots";

/**
 * What the tenant console looks like, at a phone width and a desktop width.
 *
 * These record the screens rather than assert anything about them; the
 * assertions before each shot only establish that the page finished arriving,
 * since a skeleton photographs as readily as the content that replaces it.
 *
 * The project runs before the publishing suites, so the console's lists hold
 * exactly what `task e2e:db` seeded, and the dates on them are the fixed ones
 * of `db/seeds/scenarios/160_screenshot_baseline.sql`.
 */
test.describe("web-admin screenshots", () => {
  for (const viewport of SCREENSHOT_VIEWPORTS) {
    test.describe(`at ${viewport.label}px`, () => {
      test.beforeEach(async ({ page }) => {
        await page.setViewportSize(viewport);
        await signInAsSeedAdmin(page, "/");
      });

      test("the dashboard", async ({ page }) => {
        await page.goto("/");

        await expect(
          page.getByRole("heading", { level: 1, name: "Dashboard" })
        ).toBeVisible();
        await expect(page.getByText("Published series")).toBeVisible();
        await expect(
          page.getByText("Publishing queue", { exact: true })
        ).toBeVisible();

        await expectScreenshot(page, viewport, "dashboard");
      });

      test("the series list", async ({ page }) => {
        await page.goto("/series");

        await expect(
          page.getByRole("heading", { level: 1, name: "Series" })
        ).toBeVisible();
        await expect(
          page.getByRole("navigation", { name: "Series list pagination" })
        ).toBeVisible();

        await expectScreenshot(page, viewport, "series-list");
      });

      test("the series edit form", async ({ page }) => {
        await page.goto(`/series/${SEED_TENANT.series.publicId}`);

        await expect(
          page.getByRole("heading", { name: "Edit series" })
        ).toBeVisible();
        await expect(page.getByRole("textbox", { name: /Title/u })).toHaveValue(
          SEED_TENANT.series.title
        );

        await expectScreenshot(page, viewport, "series-edit");
      });

      test("the theme settings with the public site preview", async ({
        page,
      }) => {
        await page.goto("/settings/theme");

        await expect(page.getByText("Public site preview")).toBeVisible();
        await expect(page.getByLabel(/Primary color/u).first()).toBeVisible();

        await expectScreenshot(page, viewport, "settings-theme");
      });
    });
  }
});
