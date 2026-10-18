import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import {
  createEpisodeViaUi,
  createSeriesViaUi,
  selectComboboxOption,
  signInAsSeedAdmin,
} from "../src/admin";
import { deleteSeriesByPublicIds } from "../src/db";
import {
  publishedAtOneHourAgo,
  uniqueSuffix,
} from "../src/scenarios/admin-publish";
import { WEB_ADMIN_BASE_URL } from "../src/urls";

const adminUrl = (pathname: string): string =>
  `${WEB_ADMIN_BASE_URL}${pathname}`;

/** Picks an episode in the volume's episode picker and adds it to the list. */
const addEpisode = async (page: Page, title: string): Promise<void> => {
  await selectComboboxOption(
    page,
    page.getByRole("combobox", { name: "Add an episode" }),
    title
  );
  await page.getByRole("button", { exact: true, name: "Add" }).click();
  await expect(
    page.getByRole("button", { name: `Reorder ${title}` })
  ).toBeVisible();
};

/**
 * Volumes in the console: an editor groups a series' episodes into a volume,
 * prices it, and puts it on sale, and the volume reads back that way.
 */
test.describe("admin volumes", () => {
  let createdSeriesIds: string[] = [];

  test.beforeEach(async ({ page }) => {
    createdSeriesIds = [];
    await signInAsSeedAdmin(page);
  });

  test.afterEach(() => {
    deleteSeriesByPublicIds(createdSeriesIds);
    createdSeriesIds = [];
  });

  test("creates a volume, assigns episodes, prices it, and puts it on sale", async ({
    page,
  }) => {
    const suffix = uniqueSuffix();
    const seriesId = await createSeriesViaUi(page, {
      publishedAt: publishedAtOneHourAgo(),
      synopsis: `Volume series ${suffix}`,
      title: `E2E Volumes ${suffix}`,
    });
    createdSeriesIds.push(seriesId);
    const firstEpisode = `E2E Volume Episode A ${suffix}`;
    const secondEpisode = `E2E Volume Episode B ${suffix}`;
    // One page drives both forms, so the episodes are created one after the
    // other.
    await createEpisodeViaUi(page, {
      price: 300,
      publishAt: publishedAtOneHourAgo(),
      seriesPublicId: seriesId,
      title: firstEpisode,
    });
    await createEpisodeViaUi(page, {
      price: 300,
      publishAt: publishedAtOneHourAgo(),
      seriesPublicId: seriesId,
      title: secondEpisode,
    });

    await page.goto(adminUrl(`/series/${seriesId}`));
    await page.getByRole("link", { exact: true, name: "Volumes" }).click();
    await expect(
      page.getByText("This series has no volumes yet.")
    ).toBeVisible();

    const volumeTitle = `Volume 1 ${suffix}`;
    await page.getByRole("textbox", { name: "Title" }).fill(volumeTitle);
    await page.getByRole("spinbutton", { name: "Price" }).fill("500");
    await page.getByRole("button", { name: "Create volume" }).click();

    await page.waitForURL(/\/series\/[^/]+\/volumes\/[^/?]+/u);
    await expect(page.getByText("Volume created.")).toBeVisible();
    const volumePath = new URL(page.url()).pathname;

    // A new volume holds nothing, so it cannot go on sale yet.
    await expect(
      page.getByRole("button", { name: "Put on sale" })
    ).toBeDisabled();

    await addEpisode(page, firstEpisode);
    await addEpisode(page, secondEpisode);
    await page.getByRole("button", { name: "Save episodes" }).click();
    await expect(page.getByText("Episodes saved.")).toBeVisible();

    await page.getByRole("spinbutton", { name: "Price" }).fill("550");
    await page.getByRole("button", { name: "Update volume" }).click();
    await expect(page.getByText("Volume updated.")).toBeVisible();

    await page.getByRole("button", { name: "Put on sale" }).click();
    await expect(page.getByText("The volume is on sale.")).toBeVisible();

    // Read back from the API rather than from what the forms still held.
    await page.goto(adminUrl(volumePath));
    await expect(page.getByRole("textbox", { name: "Title" })).toHaveValue(
      volumeTitle
    );
    await expect(page.getByRole("spinbutton", { name: "Price" })).toHaveValue(
      "550"
    );
    const handles = page.getByRole("button", { name: /^Reorder E2E Volume/u });
    await expect(handles).toHaveText([
      `Reorder ${firstEpisode}`,
      `Reorder ${secondEpisode}`,
    ]);
    await expect(
      page.getByRole("button", { name: "Take off sale" })
    ).toBeVisible();
    // Once on sale, what the volume held stays in it.
    await expect(
      page.getByRole("button", { name: `Remove ${firstEpisode}` })
    ).toHaveCount(0);
    // An episode in a volume is offered to no other.
    await expect(
      page.getByText("Every episode of this series is already in a volume.")
    ).toBeVisible();

    await page.getByRole("link", { name: "Back to volumes" }).click();
    const row = page.getByRole("listitem").filter({ hasText: volumeTitle });
    await expect(row).toContainText("550");
    await expect(row).toContainText("2 episodes");
    await expect(row).toContainText("On sale");
  });
});
