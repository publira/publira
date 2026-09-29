import type { Page } from "@playwright/test";
import { expect } from "@playwright/test";

/**
 * Assert that nothing on the page can move.
 *
 * The whole tree is read rather than the handful of elements a screen animates
 * today, so a screen written later is covered without being named here, and
 * every pseudo-element with it, because a skeleton or a spinner is as often a
 * `::before` as an element of its own. A computed duration is always in
 * seconds, so `"0s"` is the whole of what a still element reports.
 */
export const expectNothingAnimates = async (page: Page): Promise<void> => {
  const moving = await page.evaluate(() => {
    const labels: string[] = [];

    for (const element of document.querySelectorAll("*")) {
      for (const pseudo of [null, "::before", "::after"]) {
        const style = getComputedStyle(element, pseudo);
        const still =
          style.animationName === "none" &&
          style.transitionDuration
            .split(",")
            .every((duration) => duration.trim() === "0s");

        if (!still) {
          const attributes = `class="${element.getAttribute("class") ?? ""}"`;
          labels.push(
            `${element.tagName.toLowerCase()}${pseudo ?? ""} [${attributes}]`
          );
        }
      }
    }

    return labels;
  });

  expect(moving).toEqual([]);
};
