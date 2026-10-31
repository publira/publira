import { expect, test } from "@playwright/test";

import { episodeFormFields, signInAsSeedAdmin } from "../src/admin";

/**
 * The seeded releases of `Seed Series 045`, at the dates
 * `db/seeds/scenarios/160_screenshot_baseline.sql` pins: the series on
 * 2026-02-19 09:00 UTC and each episode six hours apart after it. The seed
 * tenant's zone is UTC, so the third episode lands on the next day.
 */
const series = "Seed Series 045";
const seriesPublicId = "SeedSERSAA45";
const firstEpisode = "Seed Episode 045-01";
const firstEpisodePublicId = "SeedEPSDA441";
const thirdEpisode = "Seed Episode 045-03";

test.describe("web-admin publishing calendar", () => {
  test("the Dashboard opens the calendar, and the calendar shows a seeded release on its day", async ({
    page,
  }) => {
    await signInAsSeedAdmin(page, "/");

    await page
      .getByRole("main")
      .getByRole("link", { exact: true, name: "Open calendar" })
      .click();
    await expect(page).toHaveURL(/\/calendar$/u);
    await expect(
      page.getByRole("heading", { exact: true, level: 1, name: "Calendar" })
    ).toBeVisible();
    await expect(
      page
        .getByRole("navigation")
        .getByRole("link", { exact: true, name: "Calendar" })
    ).toHaveAttribute("aria-current", "page");

    await page.goto("/calendar?month=2026-03");
    await page
      .getByRole("link", { exact: true, name: "Previous month" })
      .click();
    await expect(page).toHaveURL(/\/calendar\?month=2026-02$/u);
    await expect(
      page.getByRole("heading", {
        exact: true,
        level: 2,
        name: "February 2026",
      })
    ).toBeVisible();

    const february19 = page.getByRole("listitem").filter({
      has: page.getByRole("heading", {
        exact: true,
        level: 3,
        name: "Feb 19, 2026",
      }),
    });

    const february20 = page.getByRole("listitem").filter({
      has: page.getByRole("heading", {
        exact: true,
        level: 3,
        name: "Feb 20, 2026",
      }),
    });

    const entry = february19.getByRole("link", { name: firstEpisode });
    await expect(entry).toContainText(series);
    await expect(entry).toContainText("Published");
    await expect(
      february19.getByRole("link", { name: thirdEpisode })
    ).toHaveCount(0);
    await expect(
      february20.getByRole("link", { name: thirdEpisode })
    ).toBeVisible();

    await entry.click();
    await expect(page).toHaveURL(
      new RegExp(
        `/series/${seriesPublicId}/episodes/${firstEpisodePublicId}$`,
        "u"
      )
    );
    await expect(episodeFormFields(page).title).toHaveValue(firstEpisode);
  });

  test("a month with no release says so", async ({ page }) => {
    await signInAsSeedAdmin(page, "/calendar?month=2020-01");

    await expect(
      page.getByRole("heading", {
        exact: true,
        level: 2,
        name: "January 2020",
      })
    ).toBeVisible();
    await expect(
      page.getByText("Nothing goes out in this month")
    ).toBeVisible();
  });
});
