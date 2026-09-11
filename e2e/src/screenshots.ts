import type { Page } from "@playwright/test";
import { expect } from "@playwright/test";

/**
 * The widths every screen is recorded at.
 *
 * A phone, because that is how most of a tenant's readers arrive, and a
 * desktop, because that is where the two consoles are used. The heights only
 * decide how much of a page is on screen at once; the shots are full-page, so
 * they do not appear in the baseline.
 */
export const SCREENSHOT_VIEWPORTS = [
  { height: 844, label: "390", width: 390 },
  { height: 900, label: "1280", width: 1280 },
] as const;

export type ScreenshotViewport = (typeof SCREENSHOT_VIEWPORTS)[number];

/**
 * Every loading placeholder on a screen, whichever component drew it.
 *
 * `Skeleton` and `SkeletonLine` word the utility as `motion-safe:animate-pulse`
 * and the placeholders written inline as plain `animate-pulse`, so the match is
 * on the substring both spell. That one utility is the whole vocabulary this
 * repository has for "the copy or the data here has not arrived yet" — nothing
 * in `apps/` or `packages/` pulses as decoration — which is what lets one
 * selector stand for a placeholder a screen has not named.
 */
const LOADING_PLACEHOLDER = '[class*="animate-pulse"]';

/**
 * The width a screen actually laid its content out at, against the width it
 * was given.
 *
 * A full-page shot is taken at the document's own scroll width, so a screen
 * whose content is laid out wider than that photographs as a screen with its
 * right-hand side missing rather than as an obviously broken one — which is
 * how a `white-space: nowrap` deep inside one component, propagated upward as
 * the min-content width of the console's page grid, reached a committed
 * baseline unnoticed. `<main>` is where that shows: it is the column the page
 * body fills in all three apps, and its scroll width is the width its content
 * demanded. The document's own scroll width covers the other ending, where
 * nothing clips and the window scrolls sideways instead.
 *
 * A box that scrolls sideways on purpose does not register here: `Table` wraps
 * itself in an `overflow-auto` container precisely so that a wide table
 * scrolls inside the page rather than widening it.
 */
const expectNoHorizontalOverflow = async (page: Page): Promise<void> => {
  const measured = await page.evaluate(() => {
    const main = document.querySelector("main");
    if (!main) {
      throw new Error("the page has no <main> to measure");
    }

    return {
      column: main.clientWidth,
      content: main.scrollWidth,
      page: document.documentElement.scrollWidth,
      viewport: document.documentElement.clientWidth,
    };
  });

  expect(
    measured.content,
    "the page content is laid out wider than the column it sits in"
  ).toBeLessThanOrEqual(measured.column + 1);
  expect(
    measured.page,
    "the document scrolls sideways at this width"
  ).toBeLessThanOrEqual(measured.viewport + 1);
};

/**
 * Record one screen, or compare it with what was recorded before.
 *
 * Full-page rather than the viewport alone: a section below the fold is as
 * much of the design as the header, and a redesign that moved one would
 * otherwise pass unseen.
 *
 * `toHaveScreenshot` waits for the page to stop changing, not for it to be
 * finished, and it freezes CSS animations for the shot — so a skeleton that is
 * still standing where a string belongs stops pulsing, holds perfectly still,
 * and photographs as readily as the copy that replaces it. Every string on
 * these screens sits behind a `Suspense` boundary of its own, which makes the
 * outcome a race: the same screen records with the label or with the skeleton
 * depending on which side of the boundary the render happened to be on. So the
 * placeholders are waited out first, and only then is the screen recorded. A
 * test still asserts the screen is the one it means before calling this.
 *
 * The quiet network is what makes that wait mean anything. A string a Client
 * Component resolves is drawn twice: the server render puts it straight into
 * the HTML, and then hydration asks the browser for the catalog chunk, suspends
 * on it, and takes the copy back out again until the chunk arrives. Counting
 * placeholders in the first of those two moments finds none, and the shot then
 * lands in the second. Once nothing is in flight there is no chunk left to
 * suspend on, so a screen with no placeholder is a screen that is finished.
 */
export const expectScreenshot = async (
  page: Page,
  viewport: ScreenshotViewport,
  name: string
): Promise<void> => {
  await page.waitForLoadState("networkidle");
  await expect(page.locator(LOADING_PLACEHOLDER)).toHaveCount(0);
  await expectNoHorizontalOverflow(page);

  await expect(page).toHaveScreenshot(`${name}-${viewport.label}.png`, {
    fullPage: true,
  });
};
