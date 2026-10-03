import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import { applyScenarioSql } from "../src/db";
import { signInAsMember, signInAsSeedMember } from "../src/host";
import {
  CREATOR_READER,
  CREATOR_READER_SCENARIO,
} from "../src/scenarios/creator-reader";
import {
  READER_RECOMMENDED_SERIES_IDS,
  seedSeriesPublicId,
} from "../src/scenarios/reading-signals";
import { hostPath } from "../src/urls";

/**
 * The recommendations a signed-in reader gets from their own reading, against
 * the order every other visitor shares.
 *
 * The development seed gives `member@example.com` a few weeks of reading and
 * the features the batch builds from it (`db/seeds/dev/090_reading_signals.sql`),
 * so My Page's Recommended section is ordered for that reader. Every other
 * reader, and every guest, gets the tenant-wide order, which on this tenant is
 * the week's chart of `170_ranking.sql` followed by the rest of the catalogue.
 *
 * The storefront's recommendation shelf, which reads the same two orders, is
 * not one of the screens here: it stands in for the chart only on a tenant the
 * ranking batch has not reached, and `task e2e:db` charts this one so the
 * screenshot projects have a ranking to photograph. My Page draws the shelf on
 * every tenant, so it is where one reader's order is set beside another's.
 */

/** The cards of My Page's Recommended section, in the order it draws them. */
const recommendedCards = (page: Page) =>
  page
    .getByRole("region", { name: "Recommended" })
    .locator(`a[href^="${hostPath("/series/")}"]`);

/**
 * The head of the tenant-wide order: the series the seeded weekly chart puts
 * first, which is also the first of the ranking of every rating together that
 * the recommendation list is built on.
 */
const tenantWideHeadId = seedSeriesPublicId(42);

test.describe("web-host reader recommendations", () => {
  test("the seed member's My Page recommends from their own reading", async ({
    page,
  }) => {
    await signInAsSeedMember(page, "/my");

    const cards = recommendedCards(page);
    // A rated cover is left out of the shelf until the browser confirms the
    // rating, which this one never has, so six cards means none was held back.
    await expect(cards).toHaveCount(READER_RECOMMENDED_SERIES_IDS.length);
    expect(
      await cards.evaluateAll((links) =>
        links.map((link) => link.getAttribute("href"))
      )
    ).toEqual(
      READER_RECOMMENDED_SERIES_IDS.map((seriesId) =>
        hostPath(`/series/${seriesId}`)
      )
    );
  });

  test("a reader with no reading of their own gets the tenant-wide order", async ({
    page,
  }) => {
    applyScenarioSql(CREATOR_READER_SCENARIO);
    await signInAsMember(page, CREATOR_READER, "/my");

    await expect(recommendedCards(page).first()).toHaveAttribute(
      "href",
      hostPath(`/series/${tenantWideHeadId}`)
    );
  });
});
