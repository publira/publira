import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";

import { runSql } from "../src/db";
import { signInAsMember } from "../src/host";
import { openHostLocaleMenu } from "../src/locale";
import { SEED_MEMBER } from "../src/scenarios/member-announcements";
import { SEED_TENANT } from "../src/scenarios/multi-tenant";
import {
  episodePageLabel,
  showsLastPage,
  VIEWER_PROGRESS_LABEL,
} from "../src/scenarios/viewer-pages";
import { WEB_HOST_BASE_URL } from "../src/urls";
import { revealViewerControls } from "../src/viewer";

const paidEpisodePath = `/series/${SEED_TENANT.series.publicId}/episodes/${SEED_TENANT.series.paidEpisodeId}`;

/**
 * An episode of a series no other suite reads as this member, so the reading
 * position opening it saves moves no "Continue reading" another suite asserts.
 */
const EPISODE_ID = "SeedEPSDAA11";
const EPISODE_TITLE = "Seed Episode 002-01";
const EPISODE_PATH = `/series/SeedSERSAAA2/episodes/${EPISODE_ID}`;

/** Put this member back where they had never opened the episode. */
const clearReadingPosition = (): void => {
  runSql(`
    DELETE FROM episode_reading_positions p
    USING users u, episodes e
    WHERE u.id = p.user_id
        AND e.id = p.episode_id
        AND u.email = '${SEED_MEMBER.email}'
        AND e.public_id = '${EPISODE_ID}';
  `);
};

const readingProgress = (page: Page) => page.getByLabel(VIEWER_PROGRESS_LABEL);

/**
 * Click the viewer at `ratio` of its width, a quarter of the way down, which
 * keeps clear of the page-turn buttons drawn across its middle. The outer
 * three tenths of either side turn a page and the band between them toggles
 * the controls.
 */
const tapViewer = async (page: Page, ratio: number): Promise<void> => {
  const viewport = page.locator(".pcv-viewport");
  const box = await viewport.boundingBox();
  if (box === null) {
    throw new Error("the viewer is not laid out");
  }
  await viewport.click({
    position: { x: box.width * ratio, y: box.height / 4 },
  });
};

/**
 * The storefront's controls, pressed by the development seed's member.
 *
 * That account holds more of a reader's records than any other the suites sign
 * in with: an access ticket and two purchases of `Seed Episode 001-10`, and
 * follows of two creators and a series. Those records reach the client
 * components of every screen it opens — the header, the viewer — so this suite
 * presses the controls as that account rather than as one that has just
 * signed up.
 */
test.describe("web-host controls for a reader with records", () => {
  test.beforeEach(() => {
    clearReadingPosition();
  });

  test.afterAll(() => {
    clearReadingPosition();
  });

  test("the header's language menu opens on the episode the member bought", async ({
    page,
  }) => {
    await signInAsMember(page, SEED_MEMBER, paidEpisodePath, WEB_HOST_BASE_URL);

    const option = await openHostLocaleMenu(page, "English", "日本語");

    await page.keyboard.press("Escape");
    await expect(option).toBeHidden();
  });

  test("the viewer turns pages by key and by tap, and a tap between shows its controls", async ({
    page,
  }) => {
    await signInAsMember(page, SEED_MEMBER, EPISODE_PATH, WEB_HOST_BASE_URL);
    await expect(
      page.locator(`canvas[aria-label="${episodePageLabel(EPISODE_TITLE, 1)}"]`)
    ).toHaveAttribute("data-page-status", "loaded");
    await expect(readingProgress(page)).toHaveAttribute(
      "aria-valuetext",
      showsLastPage(1)
    );

    // Right to left: the left arrow and the left edge go forward. The cover
    // stands alone, so each step forward ends two pages further on.
    await page.keyboard.press("ArrowLeft");
    await expect(readingProgress(page)).toHaveAttribute(
      "aria-valuetext",
      showsLastPage(3)
    );

    await tapViewer(page, 0.1);
    await expect(readingProgress(page)).toHaveAttribute(
      "aria-valuetext",
      showsLastPage(5)
    );

    await tapViewer(page, 0.9);
    await expect(readingProgress(page)).toHaveAttribute(
      "aria-valuetext",
      showsLastPage(3)
    );

    await revealViewerControls(page);
  });
});
