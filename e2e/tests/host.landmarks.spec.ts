import { expect, test } from "@playwright/test";

import { signInAsSeedMember } from "../src/host";
import { MISSING_PUBLIC_ID, SEED_TENANT } from "../src/scenarios/multi-tenant";
import { hostPath } from "../src/urls";

/** Seeded by `db/seeds/dev/010_catalog.sql`, like the ones in `catalog.filters.spec.ts`. */
const SEED_GENRE_PUBLIC_ID = "SeedGENRAAA1";
const SEED_TAG_SLUG = "time-travel";

/**
 * Screens under `(site)`, all of which sit inside the `<main>` the site chrome
 * draws. Each one is judged once its own `h1` is up, so the page body has
 * streamed in before the landmarks are counted.
 */
const SITE_PATHS = [
  "/",
  "/series",
  `/series/${SEED_TENANT.series.publicId}`,
  `/series/${SEED_TENANT.series.publicId}/episodes/${SEED_TENANT.series.freeEpisodeId}`,
  "/labels",
  `/labels/${SEED_TENANT.labelId}`,
  "/genres",
  `/genres/${SEED_GENRE_PUBLIC_ID}`,
  `/tags/${SEED_TAG_SLUG}`,
  "/creators",
  `/creators/${SEED_TENANT.creatorId}`,
  "/search?q=Seed",
  "/ranking",
  "/privacy",
  `/series/${MISSING_PUBLIC_ID}`,
] as const;

test.describe("web-host main landmark", () => {
  for (const path of SITE_PATHS) {
    test(`${path} has exactly one main landmark`, async ({ page }) => {
      await page.goto(hostPath(path));

      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await expect(page.getByRole("main")).toHaveCount(1);
    });
  }

  test("the age rating gate has exactly one main landmark", async ({
    page,
  }) => {
    await page.goto(hostPath(`/series/${SEED_TENANT.r15Series.publicId}`));

    await expect(
      page.getByRole("button", { name: "I am 15 or older" })
    ).toBeVisible();
    await expect(page.getByRole("main")).toHaveCount(1);
  });

  test("the settings screens have exactly one main landmark", async ({
    page,
  }) => {
    await signInAsSeedMember(page, "/settings");

    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByRole("main")).toHaveCount(1);
  });
});
