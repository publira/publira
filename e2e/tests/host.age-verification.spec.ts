import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import { applyScenarioSql } from "../src/db";
import { uploadEpisodePages } from "../src/episode-pages";
import { signInAsMember } from "../src/host";
import {
  AGE_VERIFICATION_ADULT,
  AGE_VERIFICATION_EPISODE,
  AGE_VERIFICATION_EPISODE_PATH,
  AGE_VERIFICATION_MINOR,
  AGE_VERIFICATION_SCENARIO,
  AGE_VERIFICATION_UNDECLARED,
} from "../src/scenarios/age-verification";
import { episodePageLabel } from "../src/scenarios/viewer-pages";
import { hostPath, WEB_HOST_AGE_VERIFICATION_BASE_URL } from "../src/urls";

/**
 * An `r18` body on a tenant that verifies ages. The birth date on the reader's
 * account decides whether the body opens, and a reader it stops is told so
 * straight away rather than first asked to confirm an age that would open
 * nothing; they are offered the one thing that would.
 */

const episodeUrl = `${WEB_HOST_AGE_VERIFICATION_BASE_URL}${hostPath(AGE_VERIFICATION_EPISODE_PATH)}`;

/** The canvas the viewer lays out for the episode's first page. */
const firstPage = (page: Page) =>
  page.locator(
    `canvas[aria-label="${episodePageLabel(AGE_VERIFICATION_EPISODE.title, 1)}"]`
  );

/** The browser's own interstitial, which a stopped reader must never meet. */
const ratingConfirmation = (page: Page) =>
  page.getByRole("button", { name: "I am 18 or older" });

// The last test gives the third member a birth date, which is written once, so
// the suite runs in order and resets itself around either outcome.
test.describe.configure({ mode: "serial" });

test.describe("web-host age verification", () => {
  test.beforeAll(() => {
    applyScenarioSql(AGE_VERIFICATION_SCENARIO);
    uploadEpisodePages(AGE_VERIFICATION_EPISODE.publicId);
  });

  test.afterAll(() => {
    applyScenarioSql(AGE_VERIFICATION_SCENARIO);
  });

  test("a guest is asked to sign in without first being asked to confirm the rating", async ({
    page,
  }) => {
    await page.goto(episodeUrl);

    await expect(
      page.getByText("This episode is age-restricted")
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Sign in to read" })
    ).toBeVisible();
    await expect(ratingConfirmation(page)).toHaveCount(0);
    await expect(firstPage(page)).toHaveCount(0);
  });

  test("a reader who is not old enough is told so and offered nothing", async ({
    page,
  }) => {
    await signInAsMember(
      page,
      AGE_VERIFICATION_MINOR,
      AGE_VERIFICATION_EPISODE_PATH,
      WEB_HOST_AGE_VERIFICATION_BASE_URL
    );

    await expect(
      page.getByText("This work is not available for your age.")
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Add your date of birth" })
    ).toHaveCount(0);
    await expect(ratingConfirmation(page)).toHaveCount(0);
    await expect(firstPage(page)).toHaveCount(0);
  });

  test("a reader old enough for the rating is never asked to confirm at all", async ({
    page,
  }) => {
    await signInAsMember(
      page,
      AGE_VERIFICATION_ADULT,
      AGE_VERIFICATION_EPISODE_PATH,
      WEB_HOST_AGE_VERIFICATION_BASE_URL
    );

    await expect(firstPage(page)).toBeVisible();
    await expect(ratingConfirmation(page)).toHaveCount(0);
    await expect(page.getByText("This episode is age-restricted")).toHaveCount(
      0
    );
  });

  test("a reader with no date on file is sent to their settings without confirming the rating, and the body opens once they give one", async ({
    page,
  }) => {
    await signInAsMember(
      page,
      AGE_VERIFICATION_UNDECLARED,
      AGE_VERIFICATION_EPISODE_PATH,
      WEB_HOST_AGE_VERIFICATION_BASE_URL
    );

    await expect(
      page.getByText(
        "This site checks your age before opening this work. Add your date of birth in your settings."
      )
    ).toBeVisible();
    await expect(ratingConfirmation(page)).toHaveCount(0);
    await page.getByRole("link", { name: "Add your date of birth" }).click();

    await expect(page).toHaveURL(/\/settings$/u);
    await page.getByLabel("Date of birth").fill("1990-04-02");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(
      page
        .getByRole("status")
        .filter({ hasText: "Your profile has been updated." })
    ).toBeVisible();
    // Written once: the input is gone and the stored day stands in its place.
    await expect(page.getByLabel("Date of birth")).toHaveCount(0);

    await page.goto(episodeUrl);

    await expect(firstPage(page)).toBeVisible();
    await expect(page.getByText("This episode is age-restricted")).toHaveCount(
      0
    );
  });
});
