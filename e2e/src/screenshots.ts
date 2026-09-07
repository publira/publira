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
 * Record one screen, or compare it with what was recorded before.
 *
 * Full-page rather than the viewport alone: a section below the fold is as
 * much of the design as the header, and a redesign that moved one would
 * otherwise pass unseen. `toHaveScreenshot` takes shots until two of them
 * agree, so a page still streaming a section in is waited out rather than
 * photographed half-drawn — but only content that arrives on its own. A test
 * asserts the screen is the one it means before calling this.
 */
export const expectScreenshot = async (
  page: Page,
  viewport: ScreenshotViewport,
  name: string
): Promise<void> => {
  await expect(page).toHaveScreenshot(`${name}-${viewport.label}.png`, {
    fullPage: true,
  });
};
