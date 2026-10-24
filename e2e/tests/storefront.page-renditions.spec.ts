import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import {
  VIEWER_EPISODE_PATH,
  VIEWER_PAGE_STORED_WIDTH,
  viewerPageImageId,
  viewerPageLabel,
} from "../src/scenarios/viewer-pages";
import { storefrontPath } from "../src/urls";

const firstPageImagePath = `/images/episodes/${viewerPageImageId(1)}`;

/**
 * The widths the reader has asked image-server for the first page at, in the
 * order it asked, from the moment this is called.
 */
const recordFirstPageWidths = (page: Page): number[] => {
  const widths: number[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    const width = url.searchParams.get("w");
    if (url.pathname === firstPageImagePath && width !== null) {
      widths.push(Number(width));
    }
  });
  return widths;
};

const expectFirstPageDrawn = (page: Page): Promise<void> =>
  expect(
    page.locator(`canvas[aria-label="${viewerPageLabel(1)}"]`)
  ).toHaveAttribute("data-page-status", "loaded");

test.describe("web-storefront page renditions", () => {
  test.describe("on a phone", () => {
    test.use({ viewport: { height: 844, width: 390 } });

    test("a page is fetched narrower than it is stored, and again wider once the viewer widens", async ({
      page,
    }) => {
      const widths = recordFirstPageWidths(page);

      await page.goto(storefrontPath(VIEWER_EPISODE_PATH));
      await expectFirstPageDrawn(page);

      expect(widths.length).toBeGreaterThan(0);
      const [narrow = 0] = widths;
      expect(narrow).toBeLessThan(VIEWER_PAGE_STORED_WIDTH);

      await page.setViewportSize({ height: 1200, width: 1920 });

      await expect
        .poll(() => Math.max(...widths), {
          message: "the page is fetched again at a larger width",
        })
        .toBeGreaterThan(narrow);
      expect(Math.max(...widths)).toBeLessThanOrEqual(VIEWER_PAGE_STORED_WIDTH);
    });
  });

  test.describe("on a wide high-density display", () => {
    test.use({
      deviceScaleFactor: 2,
      viewport: { height: 1440, width: 2560 },
    });

    test("a page is fetched at its stored width and no wider", async ({
      page,
    }) => {
      const widths = recordFirstPageWidths(page);

      await page.goto(storefrontPath(VIEWER_EPISODE_PATH));
      await expectFirstPageDrawn(page);

      expect(Math.max(...widths)).toBe(VIEWER_PAGE_STORED_WIDTH);
    });
  });
});
