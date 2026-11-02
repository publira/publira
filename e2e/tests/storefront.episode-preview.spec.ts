import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import { applyScenarioSql } from "../src/db";
import {
  revalidateStorefrontTags,
  tenantSeriesDetailTag,
  tenantSeriesTag,
} from "../src/revalidate";
import { SEED_TENANT_ID } from "../src/scenarios/auth";
import {
  EPISODE_PREVIEW_EPISODE,
  EPISODE_PREVIEW_PATH,
  EPISODE_PREVIEW_SCENARIO,
  EPISODE_PREVIEW_SERIES,
} from "../src/scenarios/episode-preview";
import {
  VIEWER_PROGRESS_LABEL,
  episodePageLabel,
  showsLastPage,
} from "../src/scenarios/viewer-pages";
import { storefrontPath } from "../src/urls";
import { turnToEndPage } from "../src/viewer";

const { previewPageCount, title } = EPISODE_PREVIEW_EPISODE;

const pageCanvas = (page: Page, pageNumber: number) =>
  page.locator(`canvas[aria-label="${episodePageLabel(title, pageNumber)}"]`);

const readingProgress = (page: Page) => page.getByLabel(VIEWER_PROGRESS_LABEL);

/**
 * The page after the preview, inside the viewer, named as a landmark the way
 * the episode's own end page is.
 */
const previewEnd = (page: Page) =>
  page.getByRole("region", { exact: true, name: "End of the preview" });

/**
 * A guest reading a priced episode's preview. The scenario prices
 * `Seed Episode 020-01` and opens three of its eight pages, a write no app saw,
 * so the episode's cached read is dropped the way the console's save drops it.
 */
test.describe("web-storefront episode preview", () => {
  test.beforeAll(async () => {
    applyScenarioSql(EPISODE_PREVIEW_SCENARIO);
    await revalidateStorefrontTags([
      tenantSeriesDetailTag(SEED_TENANT_ID),
      tenantSeriesTag(SEED_TENANT_ID, EPISODE_PREVIEW_SERIES.publicId),
    ]);
  });

  test("a signed-out reader turns the preview pages and meets the purchase gate after the last of them", async ({
    page,
  }) => {
    // Revalidation marks the entry stale rather than dropping it, so the load
    // that follows it may still be the free episode's.
    await expect
      .poll(
        async () => {
          await page.goto(storefrontPath(EPISODE_PREVIEW_PATH));

          return await readingProgress(page).getAttribute("aria-valuetext");
        },
        { timeout: 60_000 }
      )
      .toMatch(showsLastPage(1, previewPageCount));

    await expect(pageCanvas(page, 1)).toHaveAttribute(
      "data-page-status",
      "loaded"
    );

    expect(
      await turnToEndPage(
        page,
        previewEnd(page).getByText("The preview ends here")
      ),
      "turning past the preview reaches the gate"
    ).toBe(true);

    const gate = previewEnd(page);
    await expect(
      gate.getByRole("link", { name: "Sign in to read" })
    ).toBeVisible();
    await expect(readingProgress(page)).toHaveAttribute(
      "aria-valuetext",
      "End of the preview"
    );
    await expect(pageCanvas(page, previewPageCount + 1)).toHaveCount(0);
    await expect(page.getByText("This episode is paid")).toHaveCount(0);

    // One page back is the last of the preview, still counted out of the
    // preview alone rather than the episode's eight pages.
    await page.keyboard.press("ArrowRight");
    await expect(readingProgress(page)).toHaveAttribute(
      "aria-valuetext",
      showsLastPage(previewPageCount, previewPageCount)
    );
  });
});
