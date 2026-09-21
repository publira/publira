import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";

import {
  captureNoticeBand,
  expectNoticeClearOf,
  expectNoticeOver,
  goOfflineAndBack,
} from "../src/offline";
import { VIEWER_EPISODE_PATH } from "../src/scenarios/viewer-pages";
import { hostPath, WEB_HOST_EDGE_BASE_URL } from "../src/urls";
import { revealViewerControls } from "../src/viewer";

/**
 * Body images are served only through the edge, so the reader is opened there
 * rather than on this project's `baseURL`.
 */
const edgeUrl = (pathname: string): string =>
  `${WEB_HOST_EDGE_BASE_URL}${hostPath(pathname)}`;

/** Whether the reader has any part of the page in full screen. */
const isFullscreen = (page: Page): Promise<boolean> =>
  page.evaluate(() => document.fullscreenElement !== null);

test.describe("web-host connectivity notice", () => {
  test("appears on the catalog top page while offline and clears on reconnect", async ({
    page,
  }) => {
    await page.goto(hostPath("/"));
    await expect(
      page.getByRole("heading", { level: 2, name: "New episodes" })
    ).toBeVisible();

    await goOfflineAndBack(page);
  });

  test("floats over the reader without covering its controls or moving it", async ({
    page,
  }) => {
    await page.goto(edgeUrl(VIEWER_EPISODE_PATH));
    const firstPage = page.locator('canvas[data-page-status="loaded"]').first();
    await expect(firstPage).toBeVisible();
    const toolbar = page.locator(".pcv-toolbar");
    const toolbarBefore = await toolbar.boundingBox();
    const pageBefore = await firstPage.boundingBox();

    await goOfflineAndBack(page, async () => {
      await expectNoticeClearOf(
        page,
        page.locator('[aria-label="Page navigation"] button')
      );
      await expectNoticeClearOf(page, toolbar);
      expect(await toolbar.boundingBox()).toEqual(toolbarBefore);
      expect(await firstPage.boundingBox()).toEqual(pageBefore);
    });
  });

  test("is painted over the reader in full screen without ending it", async ({
    page,
  }) => {
    await page.goto(edgeUrl(VIEWER_EPISODE_PATH));
    await expect(
      page.locator('canvas[data-page-status="loaded"]').first()
    ).toBeVisible();
    await revealViewerControls(page);

    await page.getByRole("button", { name: "Enter full screen" }).click();

    await expect.poll(() => isFullscreen(page)).toBe(true);
    const withoutNotice = await captureNoticeBand(page);

    await goOfflineAndBack(page, async () => {
      await expectNoticeOver(page, withoutNotice);
      expect(await isFullscreen(page), "going offline left full screen").toBe(
        true
      );
    });

    expect(await isFullscreen(page), "reconnecting left full screen").toBe(
      true
    );
  });
});
