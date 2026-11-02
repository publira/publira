import { expect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";

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

/** The section of the volume's screen under the level-2 heading `name`. */
const sectionNamed = (page: Page, name: string): Locator =>
  page
    .locator("section")
    .filter({ has: page.getByRole("heading", { exact: true, level: 2, name }) })
    .last();

/** Adds a bookstore link at the end of the list and fills it in. */
const addBookstoreLink = async (
  section: Locator,
  link: { label: string; url: string }
): Promise<void> => {
  const before = await section.getByRole("listitem").count();
  await section.getByRole("button", { name: "Add a link" }).click();
  const row = section.getByRole("listitem").nth(before);
  await row.getByRole("textbox", { name: "Label" }).fill(link.label);
  await row.getByRole("textbox", { name: "URL" }).fill(link.url);
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

  test("saves a volume's bookstore links in order and clears them again", async ({
    page,
  }) => {
    const suffix = uniqueSuffix();

    const seriesId = await createSeriesViaUi(page, {
      publishedAt: publishedAtOneHourAgo(),
      synopsis: `Bookstore link series ${suffix}`,
      title: `E2E Bookstore Links ${suffix}`,
    });

    createdSeriesIds.push(seriesId);

    await page.goto(adminUrl(`/series/${seriesId}/volumes`));
    const volumeTitle = `Volume 1 ${suffix}`;
    await page.getByRole("textbox", { name: "Title" }).fill(volumeTitle);
    await page.getByRole("spinbutton", { name: "Price" }).fill("500");
    await page.getByRole("button", { name: "Create volume" }).click();
    await page.waitForURL(/\/series\/[^/]+\/volumes\/[^/?]+/u);
    const volumePath = new URL(page.url()).pathname;
    const volumePublicId = volumePath.split("/").at(-1) ?? "";

    const links = sectionNamed(page, "Bookstore links");
    await expect(
      links.getByText("This volume has no bookstore links.")
    ).toBeVisible();

    // An http URL is refused on its row before anything is sent.
    await addBookstoreLink(links, {
      label: "Bookstore A",
      url: "http://books.example.com/volume-1",
    });
    await links.getByRole("button", { name: "Save bookstore links" }).click();
    await expect(
      links
        .getByRole("listitem")
        .nth(0)
        .getByText(
          "Enter a URL that starts with https:// and is at most 2,048 characters for link 1."
        )
    ).toBeVisible();

    await links
      .getByRole("listitem")
      .nth(0)
      .getByRole("textbox", { name: "URL" })
      .fill("https://books.example.com/volume-1");
    // So is a label past 50 characters, naming the row it is on.
    await addBookstoreLink(links, {
      label: "B".repeat(51),
      url: "https://shop.example.net/v1",
    });
    await links.getByRole("button", { name: "Save bookstore links" }).click();
    await expect(
      links
        .getByRole("listitem")
        .nth(1)
        .getByText("Enter a label of 1 to 50 characters for link 2.")
    ).toBeVisible();

    await links
      .getByRole("listitem")
      .nth(1)
      .getByRole("textbox", { name: "Label" })
      .fill("Bookstore B");
    await links.getByRole("button", { name: "Save bookstore links" }).click();
    await expect(page.getByText("Bookstore links saved.")).toBeVisible();

    // Read back through ListVolumes rather than from what the form still held.
    await page.reload();
    const saved = sectionNamed(page, "Bookstore links");
    const savedRows = saved.getByRole("listitem");
    await expect(savedRows).toHaveCount(2);
    await expect(
      savedRows.nth(0).getByRole("textbox", { name: "Label" })
    ).toHaveValue("Bookstore A");
    await expect(
      savedRows.nth(0).getByRole("textbox", { name: "URL" })
    ).toHaveValue("https://books.example.com/volume-1");
    await expect(
      savedRows.nth(1).getByRole("textbox", { name: "Label" })
    ).toHaveValue("Bookstore B");
    await expect(
      savedRows.nth(1).getByRole("textbox", { name: "URL" })
    ).toHaveValue("https://shop.example.net/v1");

    await page.getByRole("link", { name: "Back to volumes" }).click();
    await expect(
      page.getByRole("listitem").filter({ hasText: volumeTitle })
    ).toContainText("2 bookstore links");

    await page.goto(
      adminUrl("/audit-logs?action=volume_bookstore_links_updated")
    );
    await expect(
      page
        .getByRole("row")
        .filter({ hasText: volumePublicId })
        .filter({ hasText: "Volume bookstore links updated" })
    ).toHaveCount(1);

    // Taking out every row and saving leaves the volume with none.
    await page.goto(adminUrl(volumePath));
    const cleared = sectionNamed(page, "Bookstore links");
    await cleared.getByRole("button", { name: "Remove Bookstore A" }).click();
    await cleared.getByRole("button", { name: "Remove Bookstore B" }).click();
    await cleared.getByRole("button", { name: "Save bookstore links" }).click();
    await expect(page.getByText("Bookstore links saved.")).toBeVisible();

    await page.reload();
    await expect(
      sectionNamed(page, "Bookstore links").getByText(
        "This volume has no bookstore links."
      )
    ).toBeVisible();
  });
});
