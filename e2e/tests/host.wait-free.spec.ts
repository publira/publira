import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import { applyScenarioSql } from "../src/db";
import { uploadEpisodePages } from "../src/episode-pages";
import { signInAsMember } from "../src/host";
import { episodePageLabel } from "../src/scenarios/viewer-pages";
import {
  WAIT_FREE_EPISODES,
  WAIT_FREE_MEMBER,
  WAIT_FREE_SCENARIO,
  WAIT_FREE_SERIES,
  waitFreeEpisodePath,
} from "../src/scenarios/wait-free";
import { WEB_HOST_WAIT_FREE_BASE_URL } from "../src/urls";

const waitFreeUrl = (pathname: string): string =>
  `${WEB_HOST_WAIT_FREE_BASE_URL}${pathname}`;

const ticketButton = (page: Page) =>
  page.getByRole("button", { name: "Read free with a ticket" });

/**
 * Wait-for-free on the storefront: the series page states the rule and marks
 * the episode it keeps a ticket off, and the episode gate spends the ticket,
 * counts down to the next one, and refuses the latest episode.
 *
 * The member's ticket is spent by the third test and stays spent for the rest
 * of the file, so the tests run in order; applying the scenario puts the ticket
 * back for the next run.
 */
test.describe.configure({ mode: "serial" });

test.describe("web-host wait-for-free", () => {
  test.beforeAll(() => {
    applyScenarioSql(WAIT_FREE_SCENARIO);
    // The pages the ticket opens are what proves it opened them, so the
    // first episode needs its fixtures behind it.
    uploadEpisodePages(WAIT_FREE_EPISODES.first.publicId);
  });

  test("the series page explains the rule and marks the latest episode", async ({
    page,
  }) => {
    await page.goto(waitFreeUrl(`/series/${WAIT_FREE_SERIES.publicId}`));

    await expect(
      page.getByText(
        "Free if you wait: a free ticket opens one paid episode for 72 hours, and your next ticket is ready 23 hours after you use one."
      )
    ).toBeVisible();
    await expect(
      page.getByText(
        "A free ticket cannot open the newest episodes marked below."
      )
    ).toBeVisible();

    const latestRow = page.getByRole("link", {
      name: new RegExp(WAIT_FREE_EPISODES.latest.title, "u"),
    });
    await expect(latestRow.getByText("No free ticket")).toBeVisible();
    const firstRow = page.getByRole("link", {
      name: new RegExp(WAIT_FREE_EPISODES.first.title, "u"),
    });
    await expect(firstRow.getByText("No free ticket")).toHaveCount(0);
  });

  test("a guest is told that signing in brings a ticket", async ({ page }) => {
    await page.goto(
      waitFreeUrl(waitFreeEpisodePath(WAIT_FREE_EPISODES.first.publicId))
    );

    await expect(
      page.getByText(
        "This series is free if you wait: sign in to read this episode with a free ticket."
      )
    ).toBeVisible();
    await expect(ticketButton(page)).toHaveCount(0);
  });

  test("a member reads an episode with the ticket, then waits for the next one", async ({
    page,
  }) => {
    const firstPath = waitFreeEpisodePath(WAIT_FREE_EPISODES.first.publicId);
    await signInAsMember(
      page,
      WAIT_FREE_MEMBER,
      firstPath,
      WEB_HOST_WAIT_FREE_BASE_URL
    );

    await expect(
      page.getByText(
        "Your free ticket for this series is ready. It opens this episode for 72 hours."
      )
    ).toBeVisible();
    await ticketButton(page).click();

    await expect(page).toHaveURL(new RegExp(`${firstPath}$`, "u"));
    await expect(
      page.locator(
        `canvas[aria-label="${episodePageLabel(WAIT_FREE_EPISODES.first.title, 1)}"]`
      )
    ).toBeVisible();
    await expect(ticketButton(page)).toHaveCount(0);

    // The ticket is spent, so the next episode counts down to the moment the
    // next one is ready, 23 hours from now.
    await page.goto(
      waitFreeUrl(waitFreeEpisodePath(WAIT_FREE_EPISODES.second.publicId))
    );
    await expect(
      page.getByText(
        /^Your next free ticket is ready in (?:22 hr \d+ min|23 hr)\.$/u
      )
    ).toBeVisible();
    await expect(ticketButton(page)).toHaveCount(0);
  });

  test("a member is told the latest episode is kept off the ticket", async ({
    page,
  }) => {
    await signInAsMember(
      page,
      WAIT_FREE_MEMBER,
      waitFreeEpisodePath(WAIT_FREE_EPISODES.latest.publicId),
      WEB_HOST_WAIT_FREE_BASE_URL
    );

    await expect(
      page.getByText(
        "This is one of the newest episodes, which a free ticket cannot open."
      )
    ).toBeVisible();
    await expect(ticketButton(page)).toHaveCount(0);
  });
});
