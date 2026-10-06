import { expect, test } from "@playwright/test";

import { signInAsSeedMember } from "../src/host";
import { SEED_TENANT } from "../src/scenarios/multi-tenant";
import { VIEWER_EPISODE_PATH } from "../src/scenarios/viewer-pages";
import {
  expectNoControlOffscreen,
  expectTapTargets,
  TABLET_HEIGHT,
  TABLET_WIDTHS,
  tapViewerControlsOut,
} from "../src/tablet";
import { hostPath } from "../src/urls";

/**
 * The storefront on a tablet, driven by touch: the project runs these under an
 * iPad descriptor, so the pointer is coarse and nothing can be hovered.
 */
test.describe("web-host header on a tablet", () => {
  for (const width of TABLET_WIDTHS) {
    test(`draws the navigation, the field, and the account actions at ${width}px`, async ({
      page,
    }) => {
      await page.setViewportSize({ height: TABLET_HEIGHT, width });
      await page.goto(hostPath("/"));

      const header = page.getByRole("banner");
      await expect(header.getByRole("link", { name: "Labels" })).toBeVisible();
      await expect(header.getByRole("link", { name: "Genres" })).toBeVisible();
      await expect(
        header.getByRole("searchbox", { name: "Search works" })
      ).toBeVisible();
      await expect(header.getByRole("link", { name: "Sign in" })).toBeVisible();
      await expect(
        header.getByRole("link", { name: "Get started" })
      ).toBeVisible();
      // The menu button is a phone's way to the same controls.
      await expect(
        header.getByRole("button", { name: "Open navigation" })
      ).toBeHidden();

      await expectNoControlOffscreen(header, width);
      await expectTapTargets(header);
    });
  }

  test("opens the language menu on a tap", async ({ page }) => {
    await page.goto(hostPath("/"));

    await page
      .getByRole("banner")
      .getByRole("button", { name: "Language" })
      .tap();
    const japanese = page.getByRole("link", { name: "日本語" });
    await expect(japanese).toBeVisible();
    await japanese.tap();

    await expect(page).toHaveURL(/\/ja\/?$/u);
  });

  test("opens the account menu and the notifications on a tap", async ({
    page,
  }) => {
    await signInAsSeedMember(page, "/");
    const header = page.getByRole("banner");

    await header.getByRole("button", { name: /^Notifications/u }).tap();
    await expect(
      page.getByRole("dialog").getByRole("link", { name: "View all" })
    ).toBeVisible();
    await page.keyboard.press("Escape");

    await header.getByRole("button", { name: "Account menu" }).tap();
    await page.getByRole("menuitem", { name: "My Page" }).tap();

    await expect(page).toHaveURL(/\/my$/u);
  });
});

test.describe("web-host comic viewer on a tablet", () => {
  test("turns pages and opens the previous episode by touch alone", async ({
    page,
  }) => {
    await page.goto(hostPath(VIEWER_EPISODE_PATH));
    await expect(
      page.locator('canvas[data-page-status="loaded"]').first()
    ).toBeVisible();

    await tapViewerControlsOut(page);
    const toolbar = page.locator(".pcv-toolbar");
    await expectTapTargets(toolbar);
    const status = toolbar.getByText(/^Pages? \d/u);
    const firstStatus = await status.textContent();

    await page.getByRole("button", { name: "Next page" }).tap();
    await expect(status).not.toHaveText(firstStatus ?? "");

    // Back on the first page, the control that has run out of pages hands
    // over to the episode before this one.
    await tapViewerControlsOut(page);
    await page.getByRole("button", { name: "Previous page" }).tap();
    await expect(status).toHaveText(firstStatus ?? "");
    await tapViewerControlsOut(page);
    await page
      .getByRole("navigation", { name: "Page navigation" })
      .getByRole("link", { name: "Previous episode" })
      .tap();

    await expect(page).toHaveURL(
      new RegExp(
        `/series/${SEED_TENANT.series.publicId}/episodes/${SEED_TENANT.series.freeEpisodeId}$`,
        "u"
      )
    );
  });

  test("shows a spread only in a viewer at least as wide as it is tall", async ({
    page,
  }) => {
    await page.goto(hostPath(VIEWER_EPISODE_PATH));
    await expect(
      page.locator('canvas[data-page-status="loaded"]').first()
    ).toBeVisible();
    const currentSlot = page
      .locator('.pcv-viewport [data-rail-slot="current"] [data-view-mode]')
      .first();

    // The project holds the tablet upright, and the viewer takes the height
    // that gives it: taller than it is wide.
    await expect(currentSlot).toHaveAttribute("data-view-mode", "single");

    // On its side the viewer is wider than it is tall.
    await page.setViewportSize({ height: 810, width: 1080 });
    await expect(currentSlot).toHaveAttribute("data-view-mode", "double");

    // A window still held upright, but with a viewer wider than it is tall:
    // the box decides, not the way the window is held.
    await page.setViewportSize({ height: 1100, width: 1000 });
    await expect(currentSlot).toHaveAttribute("data-view-mode", "double");

    await page.setViewportSize({ height: 1080, width: 810 });
    await expect(currentSlot).toHaveAttribute("data-view-mode", "single");
  });
});
