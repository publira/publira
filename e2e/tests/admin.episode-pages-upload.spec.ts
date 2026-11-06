import { writeFile } from "node:fs/promises";

import { expect, test } from "@playwright/test";
import type { Page, TestInfo } from "@playwright/test";

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

/** `EPISODE_PAGES_UPLOAD_MAX_BYTES` in the console. */
const UPLOAD_LIMIT_BYTES = 128 * 1024 * 1024;

/**
 * A ZIP of one page, grown to exactly `bytes` by an entry that is no image,
 * which publira server skips: the size is what the limit is about, and a single
 * small page is all that has to be stored.
 */
const zipOfBytes = (bytes: number) => {
  const page = { data: noisePng(600, 580), name: "pages/001.png" };
  const name = "padding.bin";

  const overhead = storedZip([
    page,
    { data: Buffer.alloc(0), name },
  ]).byteLength;

  return storedZip([page, { data: Buffer.alloc(bytes - overhead), name }]);
};

// Playwright hands a buffer this large to the browser only from a file.
const submitZip = async (page: Page, testInfo: TestInfo, archive: Buffer) => {
  const archivePath = testInfo.outputPath("episode.zip");
  await writeFile(archivePath, archive);

  await page.locator('input[name="archive"]').setInputFiles(archivePath);
  await page.getByRole("button", { name: "Add a ZIP" }).click();
};

const pageImages = (page: Page) =>
  page
    .getByRole("list", { exact: true, name: "Registered page images" })
    .getByRole("listitem");

/**
 * A whole episode sent as one ZIP: a hundred pages of about 1 MB each, ten
 * times what a Server Action body is allowed to carry. The upload going
 * through, and every page arriving, is what shows it travels outside one. The
 * limit the screen states is held from both sides of it, through the console
 * and publira server alike.
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

  /** A new episode's edit screen, in the mode that adds a ZIP. */
  const openZipUpload = async (page: Page) => {
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

    await page.goto(
      `${WEB_ADMIN_BASE_URL}/series/${seriesId}/episodes/${episodeId}`
    );
    await page.getByRole("button", { name: "Use a ZIP" }).click();
  };

  test("adds a ZIP of a hundred 1 MB pages in one upload", async ({
    page,
  }, testInfo) => {
    // Storing a hundred pages and their variants takes a while.
    test.setTimeout(300_000);

    await openZipUpload(page);

    // 600x580 RGB noise is 1,044,000 bytes of pixels, which no compression
    // shrinks.
    const archive = storedZip(
      Array.from({ length: PAGE_COUNT }, (_, index) => ({
        data: noisePng(600, 580),
        name: `pages/${String(index + 1).padStart(3, "0")}.png`,
      }))
    );

    expect(archive.byteLength).toBeGreaterThan(PAGE_COUNT * 1_000_000);

    await submitZip(page, testInfo, archive);

    await expect(page.getByText("Page images added.")).toBeVisible({
      timeout: 240_000,
    });
    await expect(pageImages(page)).toHaveCount(PAGE_COUNT);
  });

  test("adds a ZIP of exactly the stated limit", async ({ page }, testInfo) => {
    test.setTimeout(180_000);

    await openZipUpload(page);

    const archive = zipOfBytes(UPLOAD_LIMIT_BYTES);

    expect(archive.byteLength).toBe(UPLOAD_LIMIT_BYTES);

    await submitZip(page, testInfo, archive);

    await expect(page.getByText("Page images added.")).toBeVisible({
      timeout: 120_000,
    });
    await expect(pageImages(page)).toHaveCount(1);
  });

  test("refuses a ZIP one byte over the stated limit without sending it", async ({
    page,
  }, testInfo) => {
    test.setTimeout(120_000);

    await openZipUpload(page);

    const sent: string[] = [];
    page.on("request", (request) => {
      if (request.url().endsWith("/api/v1/episode-pages")) {
        sent.push(request.url());
      }
    });

    await submitZip(page, testInfo, zipOfBytes(UPLOAD_LIMIT_BYTES + 1));

    await expect(
      page.getByText("Keep each upload to 128MB or less", { exact: false })
    ).toBeVisible();
    expect(sent).toEqual([]);
    await expect(pageImages(page)).toHaveCount(0);
  });
});
