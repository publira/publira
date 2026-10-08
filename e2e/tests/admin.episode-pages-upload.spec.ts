import { writeFile } from "node:fs/promises";

import { expect, test } from "@playwright/test";

import {
  createEpisodeViaUi,
  createSeriesViaUi,
  signInAsSeedAdmin,
} from "../src/admin";
import { deleteSeriesByPublicIds } from "../src/db";
import { noisePng, storedZip } from "../src/page-archive";
import { uniqueSuffix } from "../src/scenarios/admin-publish";
import { WEB_ADMIN_BASE_URL } from "../src/urls";

const PAGE_COUNT = 100;

/**
 * A whole episode sent as one ZIP: a hundred pages of about 1 MB each, ten
 * times what a Server Action body is allowed to carry. The upload going
 * through, and every page arriving, is what shows it travels outside one.
 */
test.describe("admin episode page upload", () => {
  let createdSeriesIds: string[] = [];

  test.beforeEach(async ({ page }) => {
    createdSeriesIds = [];
    await signInAsSeedAdmin(page);
  });

  test.afterEach(() => {
    deleteSeriesByPublicIds(createdSeriesIds);
    createdSeriesIds = [];
  });

  test("adds a ZIP of a hundred 1 MB pages in one upload", async ({
    page,
  }, testInfo) => {
    // Storing a hundred pages and their variants takes a while.
    test.setTimeout(300_000);

    const suffix = uniqueSuffix();
    const seriesId = await createSeriesViaUi(page, {
      synopsis: `E2E page upload synopsis ${suffix}`,
      title: `E2E Page Upload Series ${suffix}`,
    });
    createdSeriesIds.push(seriesId);
    const episodeId = await createEpisodeViaUi(page, {
      seriesPublicId: seriesId,
      title: `E2E Page Upload Episode ${suffix}`,
    });

    // 600x580 RGB noise is 1,044,000 bytes of pixels, which no compression
    // shrinks.
    const archive = storedZip(
      Array.from({ length: PAGE_COUNT }, (_, index) => ({
        data: noisePng(600, 580),
        name: `pages/${String(index + 1).padStart(3, "0")}.png`,
      }))
    );
    expect(archive.byteLength).toBeGreaterThan(PAGE_COUNT * 1_000_000);
    // Playwright hands a buffer this large to the browser only from a file.
    const archivePath = testInfo.outputPath("episode.zip");
    await writeFile(archivePath, archive);

    await page.goto(
      `${WEB_ADMIN_BASE_URL}/series/${seriesId}/episodes/${episodeId}`
    );
    await page.getByRole("button", { name: "Use a ZIP" }).click();
    await page.locator('input[name="archive"]').setInputFiles(archivePath);
    await page.getByRole("button", { name: "Add a ZIP" }).click();

    await expect(page.getByText("Page images added.")).toBeVisible({
      timeout: 240_000,
    });
    await expect(
      page
        .getByRole("list", { exact: true, name: "Registered page images" })
        .getByRole("listitem")
    ).toHaveCount(PAGE_COUNT);
  });
});
