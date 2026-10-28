import { expect, test } from "@playwright/test";

import { signInAsSeedAdmin } from "../src/admin";
import { SEED_TENANT } from "../src/scenarios/multi-tenant";
import {
  VIEWER_EPISODE_PATH,
  viewerPageLabel,
} from "../src/scenarios/viewer-pages";
import { storefrontPath } from "../src/urls";

/**
 * The last item of "Verify a restore" in
 * `docs/en/2-deployments/9-backup-and-restore.md`, on the services
 * `scripts/backup-and-restore.sh` restored from a backup of the seed: the
 * rows came back with the database, and the images they name with the bucket.
 */
test.describe("a restored install", () => {
  test("the tenant console signs its administrator in", async ({ page }) => {
    await signInAsSeedAdmin(page);

    await expect(page).toHaveURL(/\/series$/u);
    // Newest first, so the first page shows the seed's last series, which the
    // restored rows hold too.
    await expect(
      page.getByRole("cell", { name: /^Seed Series \d{3}$/u }).first()
    ).toBeVisible();
  });

  test("the tenant site shows a series' cover", async ({ page }) => {
    await page.goto(storefrontPath(`/series/${SEED_TENANT.series.publicId}`));

    // `naturalWidth` is what tells a delivered image from one whose request
    // failed: a key the bucket does not hold still lays out an `<img>`.
    const cover = page
      .getByRole("img", { exact: true, name: SEED_TENANT.series.title })
      .first();
    await expect
      .poll(() =>
        cover.evaluate(
          (image: HTMLImageElement) => image.complete && image.naturalWidth > 0
        )
      )
      .toBe(true);
  });

  test("the tenant site shows an episode's pages", async ({ page }) => {
    await page.goto(storefrontPath(VIEWER_EPISODE_PATH));

    await expect(
      page.locator(`canvas[aria-label="${viewerPageLabel(1)}"]`)
    ).toHaveAttribute("data-page-status", "loaded");
  });
});
