import { expect } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";

/** How many forward turns reach the end of any episode the seeds hold. */
const TURN_LIMIT = 12;

/** How long one turn has to settle before another key press is worth trying. */
const TURN_SETTLE_MS = 1000;

/**
 * Turn forward until `control` is on screen, and answer whether it ever was.
 *
 * Everything a reader does once they have finished the episode — reacting to
 * it, reading what others said, saying something — is on the page after the
 * last page, so a test that is about any of it has to read the episode first.
 * The reading direction is right to left, which makes ArrowLeft the next page,
 * and how many turns that takes depends on how the viewer pairs the pages into
 * spreads at the window's width.
 *
 * Waiting for the control between presses is what absorbs both the presses that
 * land before the reader has hydrated — those reach no listener at all — and
 * the ones that land while the rail is still animating.
 *
 * It answers `false` rather than failing, so a caller can ask whether the page
 * carries the control at all.
 */
export const turnToEndPage = async (
  page: Page,
  control: Locator,
  turns = TURN_LIMIT
): Promise<boolean> => {
  if (turns === TURN_LIMIT) {
    // The reader fetches and draws its pages in the browser, so a drawn page is
    // also the proof that the key presses below reach a listener at all. On a
    // cold first navigation they would otherwise be spent before it hydrates.
    await expect(
      page.locator('canvas[data-page-status="loaded"]').first()
    ).toBeVisible();
  }

  try {
    await control.waitFor({ state: "visible", timeout: TURN_SETTLE_MS });
    return true;
  } catch (error) {
    if (!(error instanceof Error && error.name === "TimeoutError")) {
      throw error;
    }
  }

  if (turns <= 0) {
    return false;
  }

  await page.keyboard.press("ArrowLeft");
  return turnToEndPage(page, control, turns - 1);
};
