import type { Locator, Page } from "@playwright/test";
import { expect, test } from "@playwright/test";

import {
  createEpisodeViaUi,
  createSeriesViaUi,
  episodeFormFields,
  seriesFormFields,
  signInAsSeedAdmin,
} from "../src/admin";
import { deleteSeriesByPublicIds } from "../src/db";
import { uniqueSuffix } from "../src/scenarios/admin-publish";

/** The language tabs of the screen in front of the user. */
const languageTabs = (page: Page): Locator =>
  page.getByRole("navigation", { name: "Languages" });

/** The tab of one language, found by the locale its link names. */
const languageTab = (page: Page, locale: string): Locator =>
  languageTabs(page).locator(`a[href$="locale=${locale}"]`);

/**
 * A series and an episode written in more than one of the site's languages,
 * through the console's language tabs. The seed tenant starts in English and
 * offers Japanese too, so a work created there has its English title and gains
 * a Japanese one on the Japanese tab.
 *
 * Series created here are deleted in `afterEach`, with their episodes and
 * translations, so the catalog the screenshot projects photograph stays as the
 * seed wrote it.
 */
test.describe("a series and its episodes in more than one language", () => {
  let createdSeriesIds: string[] = [];

  test.beforeEach(async ({ page }) => {
    createdSeriesIds = [];
    await signInAsSeedAdmin(page);
  });

  test.afterEach(() => {
    deleteSeriesByPublicIds(createdSeriesIds);
    createdSeriesIds = [];
  });

  test("gives a series a title and synopsis in a second language without changing the first", async ({
    page,
  }) => {
    const suffix = uniqueSuffix();
    const title = `E2E Translated Series ${suffix}`;
    const synopsis = `The English synopsis ${suffix}`;
    const japaneseTitle = `${title} (Japanese edition)`;
    const japaneseSynopsis = `The Japanese synopsis ${suffix}`;

    const seriesId = await createSeriesViaUi(page, { synopsis, title });
    createdSeriesIds.push(seriesId);

    // The series was written in the site's default language, so that is the
    // tab it opens on, and the only one with a translation.
    await expect(languageTab(page, "en")).toHaveAttribute(
      "aria-current",
      "page"
    );
    await expect(languageTab(page, "ja")).toContainText("(not added)");

    await languageTab(page, "ja").click();
    await page.waitForURL((url) => url.searchParams.get("locale") === "ja");
    const fields = seriesFormFields(page);
    await expect(
      page.getByText("This series has no", { exact: false })
    ).toBeVisible();
    await expect(fields.title).toHaveValue("");
    await expect(fields.synopsis).toHaveValue("");

    await fields.title.fill(japaneseTitle);
    await fields.synopsis.fill(japaneseSynopsis);
    await page.getByRole("button", { name: "Update series" }).click();
    await expect(page.getByText("Series updated.")).toBeVisible({
      timeout: 30_000,
    });
    // The save returns to the tab it was made on, now a translation of its own.
    await expect(languageTab(page, "ja")).toHaveAttribute(
      "aria-current",
      "page"
    );
    await expect(languageTab(page, "ja")).not.toContainText("(not added)");
    await expect(fields.title).toHaveValue(japaneseTitle);
    await expect(fields.synopsis).toHaveValue(japaneseSynopsis);

    await languageTab(page, "en").click();
    await page.waitForURL((url) => url.searchParams.get("locale") === "en");
    await expect(fields.title).toHaveValue(title);
    await expect(fields.synopsis).toHaveValue(synopsis);

    // The list names the series in the site's default language.
    await page.getByRole("link", { exact: true, name: "Series" }).click();
    await page.waitForURL((url) => url.pathname === "/series");
    await expect(page.getByText(title, { exact: true })).toBeVisible();
    await expect(page.getByText(japaneseTitle, { exact: true })).toHaveCount(0);
  });

  test("adds an episode's title in a second language and deletes it again", async ({
    page,
  }) => {
    const suffix = uniqueSuffix();
    const seriesId = await createSeriesViaUi(page, {
      synopsis: `Synopsis ${suffix}`,
      title: `E2E Translated Episode Series ${suffix}`,
    });
    createdSeriesIds.push(seriesId);
    const title = `E2E Episode ${suffix}`;
    const japaneseTitle = `${title} (Japanese edition)`;

    await createEpisodeViaUi(page, { seriesPublicId: seriesId, title });

    await languageTab(page, "ja").click();
    await page.waitForURL((url) => url.searchParams.get("locale") === "ja");
    const fields = episodeFormFields(page);
    await expect(fields.title).toHaveValue("");
    await fields.title.fill(japaneseTitle);
    await page.getByRole("button", { name: "Add translation" }).click();
    await expect(page.getByText("Title updated.")).toBeVisible({
      timeout: 30_000,
    });
    await expect(fields.title).toHaveValue(japaneseTitle);

    await languageTab(page, "en").click();
    await page.waitForURL((url) => url.searchParams.get("locale") === "en");
    await expect(fields.title).toHaveValue(title);

    await languageTab(page, "ja").click();
    await page.waitForURL((url) => url.searchParams.get("locale") === "ja");
    await page.getByRole("button", { name: "Delete this translation" }).click();
    await page
      .getByRole("alertdialog")
      .getByRole("button", { exact: true, name: "Delete" })
      .click();
    await expect(page.getByText("Translation deleted.")).toBeVisible({
      timeout: 30_000,
    });
    // Deleting leaves for the default language, and the Japanese tab is one
    // to add again.
    await expect(languageTab(page, "en")).toHaveAttribute(
      "aria-current",
      "page"
    );
    await expect(languageTab(page, "ja")).toContainText("(not added)");
    await expect(fields.title).toHaveValue(title);
  });
});
