import { expect, test } from "@playwright/test";

import {
  createEpisodeViaUi,
  createSeriesViaUi,
  episodeFormFields,
  signInAsSeedAdmin,
} from "../src/admin";
import { deleteSeriesByPublicIds } from "../src/db";
import { noisePng } from "../src/page-archive";
import { uniqueSuffix } from "../src/scenarios/admin-publish";
import { WEB_ADMIN_BASE_URL } from "../src/urls";

/** An image `src` naming the image at `path`, whatever media token follows. */
const showing = (path: string) => new RegExp(`^${path}\\?`, "u");

/**
 * What an editor changes on an episode after it was created: its title, its
 * price and reading period, and one page at a time. The replacing image is larger than a Server Action body
 * is allowed to be, so it going through shows the page travels outside one.
 */
test.describe("admin episode editing", () => {
  let createdSeriesIds: string[] = [];

  test.beforeEach(async ({ page }) => {
    createdSeriesIds = [];
    await signInAsSeedAdmin(page);
  });

  test.afterEach(() => {
    deleteSeriesByPublicIds(createdSeriesIds);
    createdSeriesIds = [];
  });

  test("renames the episode, and replaces and deletes its pages", async ({
    page,
  }) => {
    // Storing the pages and their variants takes a while.
    test.setTimeout(180_000);

    const suffix = uniqueSuffix();
    const seriesId = await createSeriesViaUi(page, {
      synopsis: `E2E episode editing synopsis ${suffix}`,
      title: `E2E Episode Editing Series ${suffix}`,
    });
    createdSeriesIds.push(seriesId);
    const episodeId = await createEpisodeViaUi(page, {
      seriesPublicId: seriesId,
      title: `E2E Episode Editing ${suffix}`,
    });
    const editPath = `${WEB_ADMIN_BASE_URL}/series/${seriesId}/episodes/${episodeId}`;

    await page.goto(editPath);
    await page.locator('input[name="pages"]').setInputFiles(
      [1, 2, 3].map((number) => ({
        buffer: noisePng(240, 320),
        mimeType: "image/png",
        name: `page-${number}.png`,
      }))
    );
    await page.getByRole("button", { name: "Add page images" }).click();
    await expect(page.getByText("Page images added.")).toBeVisible({
      timeout: 60_000,
    });

    const pages = page.getByRole("list", {
      exact: true,
      name: "Registered page images",
    });
    const pageImage = (position: number) =>
      pages.getByRole("img", { exact: true, name: `Page ${position}` });
    await expect(pages.getByRole("listitem")).toHaveCount(3);
    /**
     * The image a page shows, by its path: the query carries a media token
     * that is signed again on every read.
     */
    const imagePath = async (position: number): Promise<string> => {
      const src = (await pageImage(position).getAttribute("src")) ?? "";
      return src.split("?")[0] ?? "";
    };

    // The title.
    const renamed = `E2E Episode Editing Renamed ${suffix}`;
    await page.getByRole("textbox", { name: "Title" }).fill(renamed);
    await page.getByRole("button", { name: "Update title" }).click();
    await expect(page.getByText("Title updated.")).toBeVisible();
    await expect(page.getByRole("textbox", { name: "Title" })).toHaveValue(
      renamed
    );

    // Replacing the second page leaves the first and the third where they
    // were. 2000x1900 RGB noise is about 11 MB, which no compression shrinks.
    const [firstBefore, secondBefore, thirdBefore] = await Promise.all(
      [1, 2, 3].map(imagePath)
    );
    await page.getByRole("button", { name: "Replace page 2" }).click();
    const replaceDialog = page.getByRole("dialog", { name: "Replace page 2" });
    await replaceDialog.getByLabel(/New page image/u).setInputFiles({
      buffer: noisePng(2000, 1900),
      mimeType: "image/png",
      name: "page-2-fixed.png",
    });
    await replaceDialog.getByRole("button", { name: "Replace page" }).click();
    await expect(page.getByText("Page replaced.")).toBeVisible({
      timeout: 60_000,
    });
    await expect(replaceDialog).toBeHidden();
    await expect(pages.getByRole("listitem")).toHaveCount(3);
    await expect(pageImage(2)).not.toHaveAttribute(
      "src",
      showing(secondBefore)
    );
    await expect(pageImage(1)).toHaveAttribute("src", showing(firstBefore));
    await expect(pageImage(3)).toHaveAttribute("src", showing(thirdBefore));
    const secondAfter = await imagePath(2);

    // Deleting the first page moves the others up one place.
    await page.getByRole("button", { name: "Delete page 1" }).click();
    await page
      .getByRole("alertdialog")
      .getByRole("button", { exact: true, name: "Delete page" })
      .click();
    await expect(page.getByText("Page deleted.")).toBeVisible();
    await expect(pages.getByRole("listitem")).toHaveCount(2);
    await expect(pageImage(1)).toHaveAttribute("src", showing(secondAfter));
    await expect(pageImage(2)).toHaveAttribute("src", showing(thirdBefore));

    // The episode list names the episode by its new title.
    await page.goto(`${WEB_ADMIN_BASE_URL}/series/${seriesId}/episodes`);
    await expect(
      page.getByRole("checkbox", { exact: true, name: `Select ${renamed}` })
    ).toBeVisible();
  });

  test("changes the price and reading period the episode is sold on", async ({
    page,
  }) => {
    const suffix = uniqueSuffix();
    const seriesId = await createSeriesViaUi(page, {
      synopsis: `E2E episode pricing synopsis ${suffix}`,
      title: `E2E Episode Pricing Series ${suffix}`,
    });
    createdSeriesIds.push(seriesId);
    const episodeId = await createEpisodeViaUi(page, {
      price: 100,
      readingPeriodHours: 72,
      seriesPublicId: seriesId,
      title: `E2E Episode Pricing ${suffix}`,
    });

    const fields = episodeFormFields(page);
    await expect(fields.price).toHaveValue("100");
    await expect(fields.readingPeriodHours).toHaveValue("72");

    await fields.price.fill("120");
    await fields.readingPeriodHours.fill("0");
    await page
      .getByRole("button", { name: "Update price and reading period" })
      .click();
    await expect(
      page.getByText("Price and reading period updated.")
    ).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`/episodes/${episodeId}\\?`, "u"));
    await expect(fields.price).toHaveValue("120");
    await expect(fields.readingPeriodHours).toHaveValue("0");

    // The episode list prices the episode at what it was changed to.
    await page.goto(`${WEB_ADMIN_BASE_URL}/series/${seriesId}/episodes`);
    await expect(page.getByText("Status: Draft / Price: ¥120")).toBeVisible();
  });
});
