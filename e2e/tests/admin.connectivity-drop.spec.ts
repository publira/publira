import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";

import {
  createEpisodeViaUi,
  createSeriesViaUi,
  signInAsSeedAdmin,
} from "../src/admin";
import { deleteSeriesByPublicIds } from "../src/db";
import { uniqueSuffix } from "../src/scenarios/admin-publish";
import { EYE_CATCH_ASPECT_FIXTURES } from "../src/scenarios/eye-catch";
import { WEB_ADMIN_BASE_URL } from "../src/urls";

const adminUrl = (pathname: string): string =>
  `${WEB_ADMIN_BASE_URL}${pathname}`;

/** How many page images the episode's grid lists. */
const registeredPageCount = (page: Page): Promise<number> =>
  page
    .getByRole("list", { exact: true, name: "Registered page images" })
    .getByRole("listitem")
    .count();

test.describe("web-admin connectivity drop", () => {
  let createdSeriesIds: string[] = [];

  test.afterEach(() => {
    deleteSeriesByPublicIds(createdSeriesIds);
    createdSeriesIds = [];
  });

  test("an episode upload started while offline completes on reconnect", async ({
    page,
  }) => {
    const suffix = uniqueSuffix();
    await signInAsSeedAdmin(page);
    const seriesId = await createSeriesViaUi(page, {
      synopsis: `E2E offline upload synopsis ${suffix}`,
      title: `E2E Offline Upload Series ${suffix}`,
    });
    createdSeriesIds.push(seriesId);
    const episodeId = await createEpisodeViaUi(page, {
      seriesPublicId: seriesId,
      title: `E2E Offline Upload Episode ${suffix}`,
    });

    await page.goto(adminUrl(`/series/${seriesId}/episodes/${episodeId}`));
    // Files set before the form hydrates are lost to it, and setting the same
    // ones again leaves the input's value where React last saw it, so no change
    // is reported. Emptying the input first is what makes each retry a change;
    // the names the form lists under it are what says it now holds them.
    const pagesInput = page.locator('input[name="pages"]');
    await expect(async () => {
      await pagesInput.setInputFiles([]);
      await pagesInput.setInputFiles([
        EYE_CATCH_ASPECT_FIXTURES.portrait,
        EYE_CATCH_ASPECT_FIXTURES.landscape,
      ]);
      await expect(page.getByText("portrait-1200x1600.jpg")).toBeVisible({
        timeout: 1000,
      });
    }).toPass({ timeout: 15_000 });

    await page.context().setOffline(true);
    const refused = page.waitForEvent(
      "requestfailed",
      (request) =>
        request.method() === "POST" && "next-action" in request.headers()
    );
    await page.getByRole("button", { name: "Add page images" }).click();
    await refused;

    // Held rather than failed: the form stays pending while the connection is
    // gone.
    await expect(page.getByRole("button", { name: "Adding..." })).toBeVisible();
    await expect(
      page.getByRole("progressbar", { name: "Upload progress" })
    ).toBeVisible();

    await page.context().setOffline(false);

    // Nothing is picked again: the files chosen before the drop are the ones
    // the retried Action carries.
    await expect(page.getByText("Page images added.")).toBeVisible({
      timeout: 60_000,
    });
    await expect.poll(() => registeredPageCount(page)).toBe(2);
  });
});
