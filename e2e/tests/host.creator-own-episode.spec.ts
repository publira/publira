import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import { applyScenarioSql } from "../src/db";
import { signInAsMember } from "../src/host";
import {
  CREATOR_READER,
  CREATOR_READER_SCENARIO,
} from "../src/scenarios/creator-reader";
import { SEED_MEMBER } from "../src/scenarios/member-announcements";
import { SEED_TENANT } from "../src/scenarios/multi-tenant";
import {
  NEXT_EPISODE_TITLE,
  VIEWER_EPISODE_PATH,
  episodePageLabel,
} from "../src/scenarios/viewer-pages";
import { WEB_HOST_EDGE_BASE_URL } from "../src/urls";
import { turnToEndPage } from "../src/viewer";

const paidEpisodePath = `/series/${SEED_TENANT.series.publicId}/episodes/${SEED_TENANT.series.paidEpisodeId}`;

const CREATOR_ACCESS = "Open to you as its author";

/** The canvas the viewer lays out for the paid episode's first page. */
const paidFirstPage = (page: Page) =>
  page.locator(
    `canvas[aria-label="${episodePageLabel(SEED_TENANT.series.paidEpisodeTitle, 1)}"]`
  );

const endPage = (page: Page) =>
  page.getByRole("region", { exact: true, name: "The end" });

/**
 * What the storefront shows the author of `Seed Series 001` on their own
 * episodes. The account holds no purchase or ticket, so the credit is the only
 * thing that opens the priced episode to it.
 *
 * Every page is opened through the edge, the one origin that also serves the
 * body images, because the reaction control sits on the page after the last
 * one and a reader only gets there by turning drawn pages.
 */
test.describe("web-host creator's own episode", () => {
  test.beforeAll(() => {
    applyScenarioSql(CREATOR_READER_SCENARIO);
  });

  test("the author reads their own paid episode as its author, without buying it", async ({
    page,
  }) => {
    await signInAsMember(
      page,
      CREATOR_READER,
      paidEpisodePath,
      WEB_HOST_EDGE_BASE_URL
    );

    await expect(paidFirstPage(page)).toBeVisible();
    await expect(page.getByText(CREATOR_ACCESS)).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Buy this episode" })
    ).toHaveCount(0);
  });

  test("a reader holding a ticket is not told they are its author", async ({
    page,
  }) => {
    await signInAsMember(
      page,
      SEED_MEMBER,
      paidEpisodePath,
      WEB_HOST_EDGE_BASE_URL
    );

    await expect(paidFirstPage(page)).toBeVisible();
    await expect(page.getByText(CREATOR_ACCESS)).toHaveCount(0);
  });

  test("the author is not offered a reaction to their own free episode", async ({
    page,
  }) => {
    await signInAsMember(
      page,
      CREATOR_READER,
      VIEWER_EPISODE_PATH,
      WEB_HOST_EDGE_BASE_URL
    );

    const nextEpisode = endPage(page).getByRole("link", {
      name: NEXT_EPISODE_TITLE,
    });
    expect(
      await turnToEndPage(page, nextEpisode),
      "the page after the last one was reached"
    ).toBe(true);
    // Every island on the end page streams behind a skeleton, so the page has
    // settled once none is left, and an absent control is then an answer.
    await expect(endPage(page).locator('[class*="animate-pulse"]')).toHaveCount(
      0
    );
    await expect(
      endPage(page).getByRole("button", { name: /React to this episode/u })
    ).toHaveCount(0);
    await expect(page.getByText(CREATOR_ACCESS)).toHaveCount(0);
  });
});
