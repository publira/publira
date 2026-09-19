import { expect, test } from "@playwright/test";

import { expectNoticeClearOf, goOfflineAndBack } from "../src/offline";
import { VIEWER_EPISODE_PATH } from "../src/scenarios/viewer-pages";
import { hostPath, WEB_HOST_EDGE_BASE_URL } from "../src/urls";

/**
 * Body images are served only through the edge, so the reader is opened there
 * rather than on this project's `baseURL`.
 */
const edgeUrl = (pathname: string): string =>
  `${WEB_HOST_EDGE_BASE_URL}${hostPath(pathname)}`;

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
});
