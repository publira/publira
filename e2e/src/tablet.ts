import { expect } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";

/**
 * The widths a tablet is held at, from the narrowest upright (an iPad mini,
 * 744px) to the widest on its side (a 12.9-inch iPad Pro, 1366px), with the
 * two edges `md` and `lg` sit on and the common sizes between them.
 */
export const TABLET_WIDTHS = [744, 768, 810, 834, 1023, 1024, 1180, 1366];

/** The height every width above is paired with; the layouts only read the width. */
export const TABLET_HEIGHT = 1024;

/** The smallest target a fingertip lands on reliably, in CSS pixels. */
export const TAP_TARGET_SIZE = 44;

/**
 * The labels of the controls inside `region` the browser is drawing whose
 * rectangle breaks the `check` rule. `checkVisibility()` leaves out what the layout
 * hides at this width, for the same reason the browser leaves it out of reach.
 */
const controlsWhere = (
  region: Locator,
  check: "offscreen" | "short",
  limit: number
): Promise<string[]> =>
  region.evaluate(
    (element, { check: kind, limit: bound }) => {
      const found: string[] = [];
      for (const control of element.querySelectorAll("a, button, input")) {
        if (!control.checkVisibility()) {
          continue;
        }
        const rect = control.getBoundingClientRect();
        const wrong =
          kind === "short"
            ? rect.height < bound
            : rect.left < 0 || rect.right > bound;
        if (wrong) {
          const label =
            control.getAttribute("aria-label") ??
            control.textContent?.trim() ??
            control.tagName;
          found.push(
            `${label} (${Math.round(rect.height)}x${Math.round(rect.width)} from ${Math.round(rect.left)} to ${Math.round(rect.right)})`
          );
        }
      }
      return found;
    },
    { check, limit }
  );

/** No control `region` draws runs past either edge of a `width` screen. */
export const expectNoControlOffscreen = async (
  region: Locator,
  width: number
): Promise<void> => {
  const offscreen = await controlsWhere(region, "offscreen", width);

  expect(offscreen, "a control runs off the screen").toEqual([]);
};

/** Every control `region` draws is at least {@link TAP_TARGET_SIZE} tall. */
export const expectTapTargets = async (region: Locator): Promise<void> => {
  const short = await controlsWhere(region, "short", TAP_TARGET_SIZE);

  expect(short, "a control is shorter than a fingertip").toEqual([]);
};

/**
 * Bring the comic viewer's controls out the way a finger does, with a tap in
 * the middle of the rail. They are `inert` while hidden and retract on a
 * timer, so the tap is repeated until they are out, as
 * `revealViewerControls` does with a click.
 */
export const tapViewerControlsOut = async (page: Page): Promise<void> => {
  const toolbar = page.locator(".pcv-toolbar");

  await expect(async () => {
    await page.locator(".pcv-viewport").tap();
    await expect(toolbar).not.toHaveAttribute("inert", { timeout: 1000 });
  }).toPass();
};
