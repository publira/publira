import { expect, test } from "@playwright/test";

import { MISSING_PUBLIC_ID, SEED_TENANT } from "../src/scenarios/multi-tenant";
import {
  VIEWER_EPISODE_PATH,
  viewerPageLabel,
} from "../src/scenarios/viewer-pages";
import { expectScreenshot, SCREENSHOT_VIEWPORTS } from "../src/screenshots";
import { hostPath } from "../src/urls";

/**
 * What the public site looks like, at a phone width and a desktop width.
 *
 * These record the screens rather than assert anything about them: a change to
 * one arrives as an image next to the image it replaces, instead of as a
 * description of it. The assertions before each shot are only there to be sure
 * the page finished arriving — every section streams in behind Suspense, and a
 * skeleton photographs as readily as the content that replaces it.
 *
 * The dates on these screens come from
 * `db/seeds/scenarios/160_screenshot_baseline.sql`, which pins what the
 * development seed dates from the moment it ran.
 */
test.describe("web-host screenshots", () => {
  for (const viewport of SCREENSHOT_VIEWPORTS) {
    test.describe(`at ${viewport.label}px`, () => {
      test.beforeEach(async ({ page }) => {
        await page.setViewportSize(viewport);
      });

      test("the catalog top page", async ({ page }) => {
        await page.goto(hostPath("/"));

        await expect(
          page.getByRole("heading", { level: 1, name: "Catalog" })
        ).toBeVisible();
        // The last of the five sections: once it holds a link, none of the
        // ones above it is still a skeleton.
        await expect(
          page
            .getByRole("region", { name: "Featured authors" })
            .locator(`a[href^="${hostPath("/authors/")}"]`)
            .first()
        ).toBeVisible();

        await expectScreenshot(page, viewport, "top-page");
      });

      test("the series list", async ({ page }) => {
        await page.goto(hostPath("/series"));

        await expect(
          page.getByRole("heading", { level: 1, name: "Series" })
        ).toBeVisible();
        await expect(
          page.getByRole("navigation", { name: "Series list pagination" })
        ).toBeVisible();

        await expectScreenshot(page, viewport, "series-list");
      });

      test("a series detail page", async ({ page }) => {
        await page.goto(hostPath(`/series/${SEED_TENANT.series.publicId}`));

        await expect(
          page.getByRole("heading", {
            level: 1,
            name: SEED_TENANT.series.title,
          })
        ).toBeVisible();
        await expect(
          page.getByRole("heading", { level: 2, name: "Episodes" })
        ).toBeVisible();

        await expectScreenshot(page, viewport, "series-detail");
      });

      test("an episode with a comic body", async ({ page }) => {
        await page.goto(hostPath(VIEWER_EPISODE_PATH));

        // The canvas reports the page it has drawn, so the shot waits for
        // pixels rather than for the element that will hold them.
        await expect(
          page.locator(`canvas[aria-label="${viewerPageLabel(1)}"]`)
        ).toHaveAttribute("data-page-status", "loaded");

        await expectScreenshot(page, viewport, "episode-comic");
      });

      // An episode carries images and nothing else today, so the second body
      // this records is the notice a reader gets when it carries none. The
      // novel text viewer the redesign will also have to cover is #445, and
      // this suite grows a screen for it when that one lands.
      test("an episode with no body", async ({ page }) => {
        await page.goto(
          hostPath(
            `/series/${SEED_TENANT.series.publicId}/episodes/${SEED_TENANT.series.freeEpisodeId}`
          )
        );

        await expect(
          page.getByRole("heading", {
            level: 1,
            name: SEED_TENANT.series.freeEpisodeTitle,
          })
        ).toBeVisible();
        await expect(
          page.getByRole("link", { name: "Go to the series" })
        ).toBeVisible();

        await expectScreenshot(page, viewport, "episode-without-body");
      });

      test("search results", async ({ page }) => {
        await page.goto(
          hostPath(`/search?q=${encodeURIComponent(SEED_TENANT.series.title)}`)
        );

        await expect(
          page.getByRole("heading", { level: 1, name: "Search" })
        ).toBeVisible();
        await expect(
          page.getByRole("heading", {
            level: 2,
            name: SEED_TENANT.series.title,
          })
        ).toBeVisible();

        await expectScreenshot(page, viewport, "search-results");
      });

      test("the sign-in screen", async ({ page }) => {
        await page.goto(hostPath("/login"));

        await expect(page.getByLabel(/Email address/u)).toBeVisible();
        await expect(
          page.getByRole("button", { name: "Sign in" })
        ).toBeVisible();

        await expectScreenshot(page, viewport, "login");
      });

      test("the not-found screen", async ({ page }) => {
        await page.goto(hostPath(`/series/${MISSING_PUBLIC_ID}`));

        await expect(
          page.getByRole("heading", { level: 1, name: "Page not found" })
        ).toBeVisible();

        await expectScreenshot(page, viewport, "not-found");
      });
    });
  }
});
